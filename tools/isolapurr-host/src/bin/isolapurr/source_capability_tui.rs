#[derive(Clone, Copy)]
enum SourceCapabilityEditorRow {
    PowerWatts,
    Pd,
    Pps,
    Qc20,
    Qc30,
    Fcp,
    Afc,
    Scp,
    Pe20,
    Bc12,
    Sfcp,
    FixedPd,
    Pps3Limit,
    PdPps5a,
    TypeCBroadcast,
    ScpLimit,
    FcpAfcSfcpLimit,
    Qc20HighVoltage,
    Qc30HighVoltage,
    Pe20HighVoltage,
    NonPd12v,
    Actions,
}

const SOURCE_CAPABILITY_EDITOR_ROWS: [SourceCapabilityEditorRow; 22] = [
    SourceCapabilityEditorRow::PowerWatts,
    SourceCapabilityEditorRow::Pd,
    SourceCapabilityEditorRow::Pps,
    SourceCapabilityEditorRow::Qc20,
    SourceCapabilityEditorRow::Qc30,
    SourceCapabilityEditorRow::Fcp,
    SourceCapabilityEditorRow::Afc,
    SourceCapabilityEditorRow::Scp,
    SourceCapabilityEditorRow::Pe20,
    SourceCapabilityEditorRow::Bc12,
    SourceCapabilityEditorRow::Sfcp,
    SourceCapabilityEditorRow::FixedPd,
    SourceCapabilityEditorRow::Pps3Limit,
    SourceCapabilityEditorRow::PdPps5a,
    SourceCapabilityEditorRow::TypeCBroadcast,
    SourceCapabilityEditorRow::ScpLimit,
    SourceCapabilityEditorRow::FcpAfcSfcpLimit,
    SourceCapabilityEditorRow::Qc20HighVoltage,
    SourceCapabilityEditorRow::Qc30HighVoltage,
    SourceCapabilityEditorRow::Pe20HighVoltage,
    SourceCapabilityEditorRow::NonPd12v,
    SourceCapabilityEditorRow::Actions,
];

struct SourceCapabilityEditorState {
    selected_row: usize,
    fixed_pd_focus: usize,
    action_focus: usize,
}

impl Default for SourceCapabilityEditorState {
    fn default() -> Self {
        Self {
            selected_row: 0,
            fixed_pd_focus: 0,
            action_focus: 0,
        }
    }
}

fn power_watt_choices(current: u8) -> Vec<u8> {
    let mut choices = POWER_WATT_PRESETS.to_vec();
    if !choices.contains(&current) {
        choices.push(current);
        choices.sort_unstable();
    }
    choices
}

fn cycle_choice<T: Copy + PartialEq>(current: T, choices: &[T], direction: i8) -> T {
    let len = choices.len();
    if len == 0 {
        return current;
    }
    let current_index = choices
        .iter()
        .position(|choice| *choice == current)
        .unwrap_or(0);
    let next_index = match direction.cmp(&0) {
        std::cmp::Ordering::Less => current_index.checked_sub(1).unwrap_or(len - 1),
        std::cmp::Ordering::Equal => current_index,
        std::cmp::Ordering::Greater => (current_index + 1) % len,
    };
    choices[next_index]
}

fn cycle_index(current: usize, len: usize, direction: i8) -> usize {
    if len == 0 {
        return current;
    }
    match direction.cmp(&0) {
        std::cmp::Ordering::Less => current.checked_sub(1).unwrap_or(len - 1),
        std::cmp::Ordering::Equal => current,
        std::cmp::Ordering::Greater => (current + 1) % len,
    }
}

fn with_tui_terminal<T>(
    viewport_height: u16,
    run: impl FnOnce(&mut DefaultTerminal) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let viewport_height = viewport_height.max(3);
    let (width, height) =
        terminal::size().context("failed to read terminal size for compact TUI viewport")?;
    let viewport_height = viewport_height.min(height.max(1));
    let mut terminal = ratatui::try_init_with_options(TerminalOptions {
        viewport: Viewport::Fixed(Rect::new(
            0,
            height.saturating_sub(viewport_height),
            width,
            viewport_height,
        )),
    })
    .context("failed to initialize compact TUI viewport")?;
    let result = run(&mut terminal);
    ratatui::restore();
    result
}

fn anchored_panel_area(area: Rect, desired_width: u16, desired_height: u16) -> Rect {
    let width = desired_width.min(area.width).max(1);
    let height = desired_height.min(area.height).max(1);
    Rect::new(
        area.x,
        area.y + area.height.saturating_sub(height),
        width,
        height,
    )
}

fn panel_block(title: &str) -> Block<'static> {
    Block::bordered()
        .title(Span::styled(
            title.to_string(),
            Style::default().add_modifier(Modifier::BOLD),
        ))
        .border_style(Style::default().fg(Color::Gray))
        .style(Style::default().fg(Color::White))
}

fn text_width(text: &str) -> u16 {
    text.lines()
        .map(|line| line.chars().count() as u16)
        .max()
        .unwrap_or(0)
}

fn truncate_to_width(text: &str, max_width: u16) -> String {
    let max_width = max_width as usize;
    let char_count = text.chars().count();
    if char_count <= max_width {
        return text.to_string();
    }
    if max_width <= 1 {
        return "…".to_string();
    }
    let kept = max_width.saturating_sub(1);
    let mut truncated = text.chars().take(kept).collect::<String>();
    truncated.push('…');
    truncated
}

fn clamp_popup_width(area: Rect, desired_width: u16, minimum_width: u16) -> u16 {
    let available = area.width.max(1);
    desired_width
        .min(available)
        .max(minimum_width.min(available))
}

fn list_menu_viewport_height(subtitle: Option<&str>, items: &[String], footer: &[&str]) -> u16 {
    let subtitle_lines = subtitle
        .map(|text| text.lines().count() as u16)
        .unwrap_or(0);
    let footer_lines = footer.len() as u16;
    let item_lines = items.len().max(1) as u16;
    subtitle_lines + footer_lines + item_lines + 6
}

fn source_capability_viewport_height(diagnostics: &str) -> u16 {
    let status_lines = diagnostics.lines().count().min(6) as u16;
    let editor_lines = SOURCE_CAPABILITY_EDITOR_ROWS.len() as u16;
    status_lines + editor_lines + 7
}

fn truncate_lines(text: &str, max_lines: usize) -> String {
    let mut lines = text.lines();
    let mut kept = Vec::new();
    for _ in 0..max_lines {
        let Some(line) = lines.next() else {
            break;
        };
        kept.push(line.to_string());
    }
    if lines.next().is_some() {
        kept.push("...".to_string());
    }
    kept.join("\n")
}

include!("source_capability_tui_parts.rs");
