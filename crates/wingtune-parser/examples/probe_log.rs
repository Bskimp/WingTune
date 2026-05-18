// One-shot diagnostic: scan a BBL/BFL file with wingtune-parser and
// dump frame counts + event breakdown. Used 2026-05-18 to investigate
// why btfl_001.bbl (2.4 MB binary data) was reporting only 25 frames
// through the WASM bridge. Run with:
//   cargo run --example probe_log -- /path/to/log.bbl
//
// SAFE TO DELETE once the upstream parsing path is verified end-to-end.

use std::env;
use std::fs;

use blackbox_log::File;
use blackbox_log::data::ParserEvent;
use blackbox_log::frame::FrameDef;
use tracing_subscriber::{EnvFilter, fmt};

fn main() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("blackbox_log=debug")),
        )
        .with_writer(std::io::stderr)
        .init();

    let path = env::args().nth(1).expect("usage: probe_log <path>");
    let bytes = fs::read(&path).expect("failed to read file");
    println!("file: {} ({} bytes)", path, bytes.len());

    let file = File::new(&bytes);
    let mut log_count = 0;
    for log in file.iter() {
        log_count += 1;
        match log {
            Ok(headers) => {
                println!("\n=== log #{log_count} headers parsed ===");
                println!("firmware: {}", headers.firmware_revision());
                println!("debug_mode: {:?}", headers.debug_mode());
                println!("main fields: {}", headers.main_frame_def().len());
                if let Some(gps) = headers.gps_frame_def() {
                    println!("gps fields:  {}", gps.len());
                }

                let mut parser = headers.data_parser();
                let mut main_count = 0u64;
                let mut event_count = 0u64;
                let mut gps_count = 0u64;
                let mut slow_count = 0u64;
                let mut first_time = None;
                let mut last_time = None;
                while let Some(ev) = parser.next() {
                    match ev {
                        ParserEvent::Main(frame) => {
                            main_count += 1;
                            let t = frame.time_raw();
                            if first_time.is_none() {
                                first_time = Some(t);
                            }
                            last_time = Some(t);
                        }
                        ParserEvent::Event(_) => event_count += 1,
                        ParserEvent::Gps(_) => gps_count += 1,
                        ParserEvent::Slow(_) => slow_count += 1,
                    }
                }
                let stats = parser.stats();
                println!("\nframe totals:");
                println!("  main:  {main_count}");
                println!("  event: {event_count}");
                println!("  gps:   {gps_count}");
                println!("  slow:  {slow_count}");
                println!("\nparser.stats() at end:");
                println!("  progress: {:.4}", stats.progress);
                println!("  counts:   {:?}", stats.counts);
                if let (Some(f), Some(l)) = (first_time, last_time) {
                    let span_sec = (l.saturating_sub(f)) as f64 / 1_000_000.0;
                    println!("\ntime span: {span_sec:.3} sec ({f} .. {l} µs)");
                    if main_count > 0 && span_sec > 0.0 {
                        println!("effective rate: {:.1} Hz", main_count as f64 / span_sec);
                    }
                }
            }
            Err(e) => {
                println!("\n=== log #{log_count} header parse FAILED ===");
                println!("error: {e}");
            }
        }
    }
    println!("\ntotal log sessions in file: {log_count}");
}
