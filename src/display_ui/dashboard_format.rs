pub(super) const UI_STATUS_NOT_PRESENT_RAW: u16 = 0x4AAC;
pub(super) const UI_STATUS_ERROR_RAW: u16 = 0x98C3;
pub(super) const UI_STATUS_OVER_RAW: u16 = 0xC201;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum OkValueError {
    Over,
}

pub(super) fn format_ok_value_6(micros: u32, unit: u8) -> Result<[u8; 6], OkValueError> {
    let milli = (micros + 500) / 1_000;
    if milli < 10_000 {
        let int = milli / 1_000;
        let frac = milli % 1_000;
        return Ok([
            b'0' + int as u8,
            b'.',
            b'0' + (frac / 100) as u8,
            b'0' + ((frac / 10) % 10) as u8,
            b'0' + (frac % 10) as u8,
            unit,
        ]);
    }

    let centi = (micros + 5_000) / 10_000;
    if centi < 10_000 {
        let int = centi / 100;
        let frac = centi % 100;
        return Ok([
            b'0' + (int / 10) as u8,
            b'0' + (int % 10) as u8,
            b'.',
            b'0' + (frac / 10) as u8,
            b'0' + (frac % 10) as u8,
            unit,
        ]);
    }

    let deci = (micros + 50_000) / 100_000;
    if deci < 10_000 {
        let int = deci / 10;
        let frac = deci % 10;
        return Ok([
            b'0' + (int / 100) as u8,
            b'0' + ((int / 10) % 10) as u8,
            b'0' + (int % 10) as u8,
            b'.',
            b'0' + frac as u8,
            unit,
        ]);
    }

    Err(OkValueError::Over)
}
