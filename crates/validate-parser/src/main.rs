use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut manifest_path: Option<PathBuf> = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" => {
                let Some(p) = args.next() else {
                    eprintln!("validate-parser: --manifest requires a path");
                    return ExitCode::from(2);
                };
                manifest_path = Some(PathBuf::from(p));
            }
            "-h" | "--help" => {
                println!("Usage: validate-parser [--manifest <path>]");
                println!();
                println!("Run with --manifest to validate a golden-log corpus manifest.");
                println!("Run with no args for a scaffold/parser-info smoke.");
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("validate-parser: unknown argument: {other}");
                return ExitCode::from(2);
            }
        }
    }

    let Some(path) = manifest_path else {
        println!("validate-parser scaffold OK; {}", wingtune_parser::parser_info());
        println!("(pass --manifest <path> to validate a corpus manifest)");
        return ExitCode::SUCCESS;
    };

    let contents = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("validate-parser: failed to read {}: {e}", path.display());
            return ExitCode::from(1);
        }
    };

    // M1.1.6 stub: full YAML parse + per-log decode validation arrives with
    // the M1.0 corpus assembly track. For now this just confirms the file
    // exists and counts top-level list entries so `npm run corpus:validate`
    // exits 0 on the empty manifest committed at scaffold time.
    let log_count = contents
        .lines()
        .filter(|l| l.trim_start().starts_with("- "))
        .count();

    println!(
        "validate-parser: read {} ({} bytes), parser: {}",
        path.display(),
        contents.len(),
        wingtune_parser::parser_info()
    );
    println!(
        "found {log_count} top-level list entries (placeholder count; full YAML parse \
         and decode validation land with M1.0 corpus track)"
    );
    ExitCode::SUCCESS
}
