fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn storage_path() -> anyhow::Result<PathBuf> {
    let dirs = project_dirs()?;
    std::fs::create_dir_all(dirs.config_dir()).context("create config dir")?;
    Ok(dirs.config_dir().join(STORAGE_FILE_NAME))
}

fn normalize_base_url(raw: &str) -> Result<String, StorageError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(StorageError::BadRequest("Base URL is required".to_string()));
    }
    let url = Url::parse(trimmed)
        .map_err(|_| StorageError::BadRequest("Base URL must be a valid URL".to_string()))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(StorageError::BadRequest(
            "Base URL must start with http:// or https://".to_string(),
        ));
    }
    Ok(url.origin().ascii_serialization())
}

fn generate_device_id() -> String {
    use rand::{Rng as _, distributions::Alphanumeric};
    let mut rng = rand::thread_rng();
    std::iter::repeat_with(|| rng.sample(Alphanumeric))
        .take(8)
        .map(char::from)
        .collect()
}

impl StorageManager {
    fn load_or_init() -> anyhow::Result<Self> {
        let path = storage_path()?;
        Self::load_at(path)
    }

    fn load_at(path: PathBuf) -> anyhow::Result<Self> {
        let mut storage = DesktopStorage::default();
        let mut should_persist = false;

        match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<DesktopStorage>(&raw) {
                Ok(parsed) => {
                    if parsed.schema_version != STORAGE_SCHEMA_VERSION {
                        let backup =
                            backup_storage_file(&path, "unsupported_schema").unwrap_or(None);
                        storage.meta = Some(StorageMeta {
                            migrated_from_localstorage_at: None,
                            last_corrupt_at: Some(now_rfc3339()),
                            last_corrupt_reason: Some(format!(
                                "unsupported_schema:{}",
                                parsed.schema_version
                            )),
                        });
                        if let Some(backup) = backup {
                            tracing::warn!(
                                path = %path.display(),
                                backup = %backup.display(),
                                "storage schema unsupported; reset to default"
                            );
                        }
                        should_persist = true;
                    } else {
                        storage = parsed;
                    }
                }
                Err(err) => {
                    let backup = backup_storage_file(&path, "corrupt").unwrap_or(None);
                    storage.meta = Some(StorageMeta {
                        migrated_from_localstorage_at: None,
                        last_corrupt_at: Some(now_rfc3339()),
                        last_corrupt_reason: Some("parse_error".to_string()),
                    });
                    if let Some(backup) = backup {
                        tracing::warn!(
                            path = %path.display(),
                            backup = %backup.display(),
                            error = %err,
                            "storage corrupted; reset to default"
                        );
                    } else {
                        tracing::warn!(
                            path = %path.display(),
                            error = %err,
                            "storage corrupted; reset to default"
                        );
                    }
                    should_persist = true;
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                storage.meta = Some(StorageMeta {
                    migrated_from_localstorage_at: None,
                    last_corrupt_at: Some(now_rfc3339()),
                    last_corrupt_reason: Some(format!("io_error:{err}")),
                });
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "storage read failed; using defaults"
                );
                should_persist = true;
            }
        }

        if should_persist {
            if let Err(err) = persist_storage(&path, &storage) {
                tracing::warn!(path = %path.display(), error = %err, "storage init persist failed");
            }
        }

        Ok(Self {
            path,
            inner: RwLock::new(storage),
        })
    }

    async fn list_devices(&self) -> Vec<StoredDevice> {
        let guard = self.inner.read().await;
        guard.devices.clone()
    }

    async fn export(&self) -> DesktopStorage {
        let guard = self.inner.read().await;
        guard.clone()
    }

    async fn get_settings(&self) -> ResolvedSettings {
        let guard = self.inner.read().await;
        ResolvedSettings {
            theme: guard.settings.resolved_theme(),
        }
    }

    async fn upsert_device(&self, input: UpsertDeviceInput) -> Result<StoredDevice, StorageError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(StorageError::BadRequest("Name is required".to_string()));
        }
        let base_url = normalize_base_url(&input.base_url)?;
        let id = input.id.map(|v| v.trim().to_string());
        if let Some(id) = &id {
            if id.is_empty() {
                return Err(StorageError::BadRequest("ID cannot be blank".to_string()));
            }
        }

        let mut guard = self.inner.write().await;
        let mut conflict = None;
        if let Some(id) = &id {
            let existing_index = guard.devices.iter().position(|d| &d.id == id);
            let base_conflict = guard
                .devices
                .iter()
                .any(|d| d.base_url == base_url && d.id != id.as_str());
            if base_conflict {
                conflict = Some("Base URL already exists".to_string());
            } else if let Some(index) = existing_index {
                guard.devices[index].name = name.to_string();
                guard.devices[index].base_url = base_url.clone();
                let stored = guard.devices[index].clone();
                persist_storage(&self.path, &guard)
                    .map_err(|err| StorageError::Internal(err.to_string()))?;
                return Ok(stored);
            } else if guard.devices.iter().any(|d| d.base_url == base_url) {
                conflict = Some("Base URL already exists".to_string());
            }
        } else if let Some(index) = guard.devices.iter().position(|d| d.base_url == base_url) {
            guard.devices[index].name = name.to_string();
            let stored = guard.devices[index].clone();
            persist_storage(&self.path, &guard)
                .map_err(|err| StorageError::Internal(err.to_string()))?;
            return Ok(stored);
        }

        if let Some(message) = conflict {
            return Err(StorageError::Conflict(message));
        }

        let new_id = id.unwrap_or_else(generate_device_id);
        if guard.devices.iter().any(|d| d.id == new_id) {
            return Err(StorageError::Conflict("ID already exists".to_string()));
        }

        let stored = StoredDevice {
            id: new_id,
            name: name.to_string(),
            base_url,
            last_seen_at: None,
        };
        guard.devices.push(stored.clone());
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(stored)
    }

    async fn delete_device(&self, device_id: &str) -> Result<(), StorageError> {
        let mut guard = self.inner.write().await;
        let before = guard.devices.len();
        guard.devices.retain(|d| d.id != device_id);
        if guard.devices.len() == before {
            return Err(StorageError::NotFound("device not found".to_string()));
        }
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    async fn update_settings(&self, theme: ThemeId) -> Result<ResolvedSettings, StorageError> {
        let mut guard = self.inner.write().await;
        guard.settings.theme = Some(theme.clone());
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(ResolvedSettings { theme })
    }

    async fn migrate_from_localstorage(
        &self,
        request: MigrateRequest,
    ) -> Result<MigrateResponse, StorageError> {
        if request.source != "localStorage" {
            return Err(StorageError::BadRequest(
                "invalid migration source".to_string(),
            ));
        }

        let mut guard = self.inner.write().await;
        let empty = guard.devices.is_empty()
            && guard.settings.resolved_theme() == ThemeId::default()
            && guard
                .meta
                .as_ref()
                .and_then(|meta| meta.migrated_from_localstorage_at.as_ref())
                .is_none();
        if !empty {
            return Ok(MigrateResponse {
                migrated: false,
                imported: None,
                reason: Some("already_initialized".to_string()),
            });
        }

        let mut imported_devices = 0usize;
        if let Some(devices) = request.devices {
            for item in devices {
                let Some(name) = item.name.as_ref() else {
                    continue;
                };
                let Some(base_url_raw) = item.base_url.as_ref() else {
                    continue;
                };
                let id = item.id.as_ref().map(|v| v.trim().to_string());
                let input = UpsertDeviceInput {
                    id,
                    name: name.clone(),
                    base_url: base_url_raw.clone(),
                };
                if self
                    .upsert_device_for_import(&mut guard, input, item.last_seen_at.clone())
                    .is_ok()
                {
                    imported_devices += 1;
                }
            }
        }

        let mut imported_settings = false;
        if let Some(settings) = request.settings {
            if let Some(theme_raw) = settings.theme {
                if let Some(theme) = ThemeId::parse(theme_raw.trim()) {
                    guard.settings.theme = Some(theme);
                    imported_settings = true;
                }
            }
        }

        let last_corrupt_at = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_at.clone());
        let last_corrupt_reason = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_reason.clone());

        guard.meta = Some(StorageMeta {
            migrated_from_localstorage_at: Some(now_rfc3339()),
            last_corrupt_at,
            last_corrupt_reason,
        });

        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;

        Ok(MigrateResponse {
            migrated: true,
            imported: Some(MigrateImported {
                devices: imported_devices,
                settings: imported_settings,
            }),
            reason: None,
        })
    }

    async fn reset(&self) -> Result<(), StorageError> {
        let mut guard = self.inner.write().await;
        let last_corrupt_at = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_at.clone());
        let last_corrupt_reason = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_reason.clone());
        *guard = DesktopStorage {
            schema_version: STORAGE_SCHEMA_VERSION,
            devices: Vec::new(),
            settings: DesktopSettings::default(),
            meta: if last_corrupt_at.is_some() || last_corrupt_reason.is_some() {
                Some(StorageMeta {
                    migrated_from_localstorage_at: None,
                    last_corrupt_at,
                    last_corrupt_reason,
                })
            } else {
                None
            },
        };
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    async fn import_storage(
        &self,
        storage: ImportStorageInput,
        mode: ImportMode,
    ) -> Result<(), StorageError> {
        if storage.schema_version != STORAGE_SCHEMA_VERSION {
            return Err(StorageError::BadRequest(
                "unsupported schema_version".to_string(),
            ));
        }

        let mut guard = self.inner.write().await;

        let mut next = if matches!(mode, ImportMode::Replace) {
            DesktopStorage::default()
        } else {
            guard.clone()
        };

        if let Some(devices) = storage.devices {
            for item in devices {
                let Some(name) = item.name.as_ref() else {
                    continue;
                };
                let Some(base_url_raw) = item.base_url.as_ref() else {
                    continue;
                };
                let id = item.id.as_ref().map(|v| v.trim().to_string());
                let input = UpsertDeviceInput {
                    id,
                    name: name.clone(),
                    base_url: base_url_raw.clone(),
                };
                let _ = self.upsert_device_for_import(&mut next, input, None);
            }
        }

        if let Some(settings) = storage.settings {
            if let Some(theme_raw) = settings.theme {
                if let Some(theme) = ThemeId::parse(theme_raw.trim()) {
                    next.settings.theme = Some(theme);
                }
            }
        }

        if let Some(meta) = storage.meta {
            next.meta = Some(StorageMeta {
                migrated_from_localstorage_at: meta.migrated_from_localstorage_at,
                last_corrupt_at: meta.last_corrupt_at,
                last_corrupt_reason: meta.last_corrupt_reason,
            });
        }

        *guard = next;
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    fn upsert_device_for_import(
        &self,
        storage: &mut DesktopStorage,
        input: UpsertDeviceInput,
        last_seen_at: Option<String>,
    ) -> Result<(), StorageError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(StorageError::BadRequest("Name is required".to_string()));
        }
        let base_url = normalize_base_url(&input.base_url)?;
        let id = input.id.map(|v| v.trim().to_string());
        if let Some(id) = &id {
            if id.is_empty() {
                return Err(StorageError::BadRequest("ID cannot be blank".to_string()));
            }
        }

        if let Some(id) = id {
            let existing_index = storage.devices.iter().position(|d| d.id == id);
            let base_conflict = storage
                .devices
                .iter()
                .any(|d| d.base_url == base_url && d.id != id.as_str());
            if base_conflict {
                return Err(StorageError::Conflict(
                    "Base URL already exists".to_string(),
                ));
            }
            if let Some(index) = existing_index {
                storage.devices[index].name = name.to_string();
                storage.devices[index].base_url = base_url;
                if let Some(last_seen_at) = last_seen_at.clone() {
                    if !last_seen_at.trim().is_empty() {
                        storage.devices[index].last_seen_at = Some(last_seen_at);
                    }
                }
                return Ok(());
            }
            if storage.devices.iter().any(|d| d.base_url == base_url) {
                return Err(StorageError::Conflict(
                    "Base URL already exists".to_string(),
                ));
            }
            storage.devices.push(StoredDevice {
                id,
                name: name.to_string(),
                base_url,
                last_seen_at: last_seen_at.filter(|value| !value.trim().is_empty()),
            });
            return Ok(());
        }

        if let Some(existing) = storage.devices.iter_mut().find(|d| d.base_url == base_url) {
            existing.name = name.to_string();
            if let Some(last_seen_at) = last_seen_at.clone() {
                if !last_seen_at.trim().is_empty() {
                    existing.last_seen_at = Some(last_seen_at);
                }
            }
            return Ok(());
        }

        storage.devices.push(StoredDevice {
            id: generate_device_id(),
            name: name.to_string(),
            base_url,
            last_seen_at: last_seen_at.filter(|value| !value.trim().is_empty()),
        });
        Ok(())
    }
}

fn backup_storage_file(path: &PathBuf, reason: &str) -> anyhow::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let file_name = format!("storage.{reason}.{timestamp}.json");
    let backup = path
        .parent()
        .map(|dir| dir.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name.clone()));
    std::fs::rename(path, &backup).context("backup storage file")?;
    Ok(Some(backup))
}

fn persist_storage(path: &PathBuf, storage: &DesktopStorage) -> anyhow::Result<()> {
    let json = serde_json::to_vec_pretty(storage).context("encode storage")?;
    let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&tmp_path, json).context("write storage tmp")?;
    if let Err(err) = std::fs::rename(&tmp_path, path) {
        if err.kind() == std::io::ErrorKind::AlreadyExists || cfg!(target_os = "windows") {
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp_path, path).context("rename storage tmp")?;
        } else {
            return Err(err).context("rename storage tmp");
        }
    }
    Ok(())
}
