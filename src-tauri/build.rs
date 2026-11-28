use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn escape_rust_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn main() {
    println!("cargo:rerun-if-changed=vendor");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vendor_dir = manifest_dir.join("vendor");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let dest_path = out_dir.join("vendor_assets.rs");

    let mut arms = Vec::new();
    let static_mappings = [
        ("/vendor/marked.js", "marked.js", "text/javascript; charset=utf-8"),
        ("/vendor/purify.js", "purify.js", "text/javascript; charset=utf-8"),
        ("/vendor/katex.js", "katex.js", "text/javascript; charset=utf-8"),
        ("/vendor/katex.css", "katex.css", "text/css; charset=utf-8"),
    ];

    if vendor_dir.is_dir() {
        for (route, rel, mime) in static_mappings {
            let file_path = vendor_dir.join(rel);
            if file_path.is_file() {
                println!("cargo:rerun-if-changed={}", file_path.display());
                arms.push(format!(
                    "        {} => Some((include_bytes!({}), {})),",
                    escape_rust_str(route),
                    escape_rust_str(&file_path.to_string_lossy()),
                    escape_rust_str(mime)
                ));
            }
        }
        let fonts_dir = vendor_dir.join("fonts");
        if fonts_dir.is_dir() {
            println!("cargo:rerun-if-changed={}", fonts_dir.display());
            if let Ok(entries) = fs::read_dir(&fonts_dir) {
                let mut font_files: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok().map(|ent| ent.path()))
                    .filter(|p| p.is_file())
                    .collect();
                font_files.sort();
                for path in font_files {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        let mime = match Path::new(name).extension().and_then(|e| e.to_str()) {
                            Some("woff2") => Some("font/woff2"),
                            Some("woff") => Some("font/woff"),
                            Some("ttf") => Some("font/ttf"),
                            _ => None,
                        };
                        if let Some(mime) = mime {
                            println!("cargo:rerun-if-changed={}", path.display());
                            let route = format!("/vendor/fonts/{name}");
                            arms.push(format!(
                                "        {} => Some((include_bytes!({}), {})),",
                                escape_rust_str(&route),
                                escape_rust_str(&path.to_string_lossy()),
                                escape_rust_str(mime)
                            ));
                        }
                    }
                }
            }
        }
    }

    let generated = format!(
        "pub fn vendor_asset(path: &str) -> Option<(&'static [u8], &'static str)> {{\n    match path {{\n{}\n        _ => None,\n    }}\n}}\n",
        arms.join("\n")
    );
    fs::write(&dest_path, generated).expect("write vendor_assets.rs");

    tauri_build::build();
}
