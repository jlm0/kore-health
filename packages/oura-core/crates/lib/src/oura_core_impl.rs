use craby::{prelude::*, throw};
use oura_protocol::protocol::Packet;
use oura_protocol::{auth, device, events, protocol};

use crate::ffi::bridging::*;
use crate::generated::*;

pub struct OuraCore {
    ctx: Context,
}

/// Decode a hex string, throwing (JS exception) on invalid input.
fn unhex(s: &str) -> Vec<u8> {
    match hex::decode(s.trim()) {
        Ok(bytes) => bytes,
        Err(e) => throw!("invalid hex string: {e}"),
    }
}

/// Decode a 16-byte hex string (auth key / encrypted nonce).
fn unhex16(s: &str) -> [u8; 16] {
    let bytes = unhex(s);
    match <[u8; 16]>::try_from(bytes.as_slice()) {
        Ok(arr) => arr,
        Err(_) => throw!("expected 16 bytes, got {}", bytes.len()),
    }
}

/// Parse a frame hex string into a `Packet` (throws on invalid hex).
fn parse_frame(frame_hex: &str) -> Option<Packet> {
    Packet::parse(&unhex(frame_hex))
}

/// Serialize a value to a JSON string, or "" for `None`.
fn json_or_empty<T: serde::Serialize>(v: Option<T>) -> String {
    v.and_then(|v| serde_json::to_string(&v).ok())
        .unwrap_or_default()
}

/// Read a required numeric field from a params JSON object.
fn param_f64(params: &serde_json::Value, key: &str) -> f64 {
    match params.get(key).and_then(|v| v.as_f64()) {
        Some(n) => n,
        None => throw!("missing or invalid numeric param \"{key}\""),
    }
}

/// Read a required boolean field from a params JSON object.
fn param_bool(params: &serde_json::Value, key: &str) -> bool {
    match params.get(key).and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => throw!("missing or invalid boolean param \"{key}\""),
    }
}

/// Read a required hex-string field from a params JSON object.
fn param_hex<'a>(params: &'a serde_json::Value, key: &str) -> &'a str {
    match params.get(key).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => throw!("missing or invalid string param \"{key}\""),
    }
}

fn encrypt_nonce_impl(key_hex: &str, nonce_hex: &str) -> String {
    let key = unhex16(key_hex);
    let nonce = unhex(nonce_hex);
    hex::encode(auth::encrypt_nonce(&key, &nonce))
}

fn parse_packet_impl(frame_hex: &str) -> String {
    match parse_frame(frame_hex) {
        Some(p) => serde_json::json!({
            "tag": p.tag,
            "payloadHex": hex::encode(&p.payload),
        })
        .to_string(),
        None => String::new(),
    }
}

fn decode_event_impl(tag: Number, body_hex: &str) -> String {
    let body = unhex(body_hex);
    json_or_empty(events::decode_event_body(tag as u8, &body))
}

fn parse_device_info_impl(frame_hex: &str) -> String {
    json_or_empty(parse_frame(frame_hex).and_then(|p| device::DeviceInfo::parse(&p)))
}

fn parse_battery_impl(frame_hex: &str) -> String {
    json_or_empty(parse_frame(frame_hex).and_then(|p| device::Battery::parse(&p)))
}

fn parse_product_ascii_impl(frame_hex: &str) -> String {
    parse_frame(frame_hex)
        .and_then(|p| device::parse_product_ascii(&p))
        .unwrap_or_default()
}

fn parse_event_batch_impl(frame_hex: &str) -> String {
    match parse_frame(frame_hex).and_then(|p| events::EventBatchSummary::parse(&p)) {
        Some(s) => serde_json::json!({
            "eventsReceived": s.events_received,
            "sleepAnalysisProgress": s.sleep_analysis_progress,
            "bytesLeft": s.bytes_left,
        })
        .to_string(),
        None => String::new(),
    }
}

/// Dispatch a `buildRequest` op to the matching `oura-protocol` request builder.
fn build_request_impl(op: &str, params_json: &str) -> String {
    let params: serde_json::Value = match serde_json::from_str(params_json) {
        Ok(v) => v,
        Err(e) => throw!("invalid params JSON: {e}"),
    };
    let bytes = match op {
        "firmware" => protocol::req_firmware(),
        "battery" => protocol::req_battery(),
        "auth_nonce" => protocol::req_auth_nonce(),
        "authenticate" => protocol::req_authenticate(&unhex16(param_hex(&params, "encryptedHex"))),
        "set_auth_key" => protocol::req_set_auth_key(&unhex16(param_hex(&params, "keyHex"))),
        "sync_time" => protocol::req_sync_time(
            param_f64(&params, "unixSecs") as u64,
            param_f64(&params, "tzHalfHours") as u8,
        ),
        "set_notification" => protocol::req_set_notification(param_f64(&params, "flags") as u8),
        "capabilities" => protocol::req_capabilities(param_f64(&params, "page") as u8),
        "product_serial" => protocol::product::SERIAL.to_vec(),
        "product_hardware" => protocol::product::HARDWARE.to_vec(),
        "product_code" => protocol::product::CODE.to_vec(),
        "get_event" => protocol::req_get_event(
            param_f64(&params, "startDs") as u32,
            param_f64(&params, "maxEvents") as u8,
            param_f64(&params, "flags") as i32,
        ),
        "feature_status" => protocol::req_feature_status(param_f64(&params, "feature") as u8),
        "feature_latest" => protocol::req_feature_latest(param_f64(&params, "feature") as u8),
        "set_feature_mode" => protocol::req_set_feature_mode(
            param_f64(&params, "feature") as u8,
            param_f64(&params, "mode") as u8,
        ),
        "set_feature_subscription" => protocol::req_set_feature_subscription(
            param_f64(&params, "capability") as u8,
            param_f64(&params, "mode") as u8,
        ),
        "check_sleep_analysis" => protocol::req_check_sleep_analysis(param_bool(&params, "force")),
        "set_realtime" => protocol::req_set_realtime(
            param_f64(&params, "bitmask") as u32,
            param_f64(&params, "maxDurationMin") as u16,
            param_f64(&params, "delay") as u8,
        ),
        "realtime_off" => protocol::req_realtime_off(),
        _ => throw!("unknown buildRequest op \"{op}\""),
    };
    hex::encode(bytes)
}

#[craby_module]
impl OuraCoreSpec for OuraCore {
    fn encrypt_nonce(&mut self, key_hex: &str, nonce_hex: &str) -> String {
        encrypt_nonce_impl(key_hex, nonce_hex)
    }

    fn parse_packet(&mut self, frame_hex: &str) -> String {
        parse_packet_impl(frame_hex)
    }

    fn decode_event(&mut self, tag: Number, body_hex: &str) -> String {
        decode_event_impl(tag, body_hex)
    }

    fn event_name(&mut self, tag: Number) -> String {
        events::event_name(tag as u8).to_string()
    }

    fn parse_device_info(&mut self, frame_hex: &str) -> String {
        parse_device_info_impl(frame_hex)
    }

    fn parse_battery(&mut self, frame_hex: &str) -> String {
        parse_battery_impl(frame_hex)
    }

    fn parse_product_ascii(&mut self, frame_hex: &str) -> String {
        parse_product_ascii_impl(frame_hex)
    }

    fn parse_event_batch(&mut self, frame_hex: &str) -> String {
        parse_event_batch_impl(frame_hex)
    }

    fn build_request(&mut self, op: &str, params_json: &str) -> String {
        build_request_impl(op, params_json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_nonce_known_answer() {
        // Vector from oura-protocol's auth tests.
        let enc = encrypt_nonce_impl(
            "4431967d8bacc2659743142b68391d9a",
            "0e2d6a0a08c99b4365f458e6e97382",
        );
        assert_eq!(enc, "a38a8772d3acb6db5c2b516dd56987c8");
    }

    #[test]
    fn parse_packet_roundtrip() {
        let v: serde_json::Value =
            serde_json::from_str(&parse_packet_impl("2f012b")).unwrap();
        assert_eq!(v["tag"], 0x2f);
        assert_eq!(v["payloadHex"], "2b");
        // Too short to hold a header.
        assert_eq!(parse_packet_impl("2f"), "");
    }

    #[test]
    fn decode_event_time_sync() {
        // tag 0x42 time_sync body: u32 LE unix time + tz bytes.
        let v: serde_json::Value =
            serde_json::from_str(&decode_event_impl(0x42u8 as Number, "4fd2376a0000000000")).unwrap();
        assert_eq!(v["unix_time"], 1_782_043_215u64);
        // Unknown tag decodes to "".
        assert_eq!(decode_event_impl(0x01u8 as Number, "00"), "");
    }

    #[test]
    fn parse_device_info_and_battery() {
        let info: serde_json::Value = serde_json::from_str(&parse_device_info_impl(
            "091202000003040301000105000cffeeddccbbaa",
        ))
        .unwrap();
        assert_eq!(info["firmware_version"], "3.4.3");
        assert_eq!(info["mac"], "aa:bb:cc:dd:ee:ff");

        let bat: serde_json::Value =
            serde_json::from_str(&parse_battery_impl("0d0659000001f00f")).unwrap();
        assert_eq!(bat["percent"], 0x59);
        // Wrong tag -> "".
        assert_eq!(parse_battery_impl("090159000001"), "");
    }

    #[test]
    fn parse_product_ascii_and_event_batch() {
        assert_eq!(
            parse_product_ascii_impl("191100585858585858585858585858"),
            "XXXXXXXXXXXX"
        );
        let batch: serde_json::Value =
            serde_json::from_str(&parse_event_batch_impl("110808009e0e00000300")).unwrap();
        assert_eq!(batch["eventsReceived"], 8);
        assert_eq!(batch["bytesLeft"], 3742);
    }

    #[test]
    fn build_request_known_hex() {
        assert_eq!(build_request_impl("firmware", "{}"), "0803000000");
        assert_eq!(
            build_request_impl("get_event", r#"{"startDs":0,"maxEvents":8,"flags":-1}"#),
            "10090000000008ffffffff"
        );
        assert_eq!(
            build_request_impl("set_realtime", r#"{"bitmask":32,"maxDurationMin":1,"delay":0}"#),
            "060720000000010000"
        );
        assert_eq!(build_request_impl("realtime_off", "{}"), "060400000000");
        assert_eq!(build_request_impl("product_serial", "{}"), "1803080010");
        assert_eq!(
            build_request_impl("sync_time", r#"{"unixSecs":1782043215,"tzHalfHours":20}"#),
            "12094fd2376a0000000014"
        );
    }

    #[test]
    #[should_panic(expected = "unknown buildRequest op")]
    fn build_request_unknown_op_panics() {
        build_request_impl("nope", "{}");
    }
}
