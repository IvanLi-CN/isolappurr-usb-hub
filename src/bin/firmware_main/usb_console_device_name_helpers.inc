#[cfg(feature = "net_http")]
async fn wait_device_name_result(api_state: &'static net::ApiSharedMutex) -> bool {
    let result = DEVICE_NAME_RESULT.wait().await;
    let mut guard = api_state.lock().await;
    guard.device_name_inflight = false;
    result
}

#[cfg(feature = "net_http")]
pub(crate) fn reset_device_name_result() {
    DEVICE_NAME_RESULT.reset();
}
