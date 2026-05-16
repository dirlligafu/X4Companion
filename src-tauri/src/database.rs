use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ── x4_data.db — données statiques du jeu ───────────────────────────────────

/// Chemin vers la copie de travail de x4_data.db dans app_data_dir/saves/
pub(crate) fn game_db_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("saves");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("x4_data.db"))
}

/// Copie x4_data.db depuis les ressources bundlées vers app_data_dir/saves/
/// uniquement si le fichier n'existe pas encore.
pub(crate) fn ensure_game_db(app: &tauri::AppHandle) {
    let dest = match game_db_path(app) {
        Some(p) => p,
        None => return,
    };
    if dest.exists() && dest.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
        return;
    }
    let src = match app.path().resource_dir().ok() {
        Some(d) => d.join("resources").join("x4_data.db"),
        None => return,
    };
    eprintln!("ensure_game_db: src={} exists={}", src.display(), src.exists());
    if let Err(e) = fs::copy(&src, &dest) {
        eprintln!("ensure_game_db: copie échouée : {e}");
    } else {
        eprintln!("ensure_game_db: OK");
    }
}

// ── Helpers DB partagés ──────────────────────────────────────────────────────

pub(crate) fn load_strings(conn: &rusqlite::Connection) -> Result<HashMap<(i64, i64), String>, String> {
    let mut strings: HashMap<(i64, i64), String> = HashMap::new();
    let mut stmt = conn.prepare("SELECT page, string_id, text FROM strings")
        .map_err(|e| format!("Prepare strings : {e}"))?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| format!("Query strings : {e}"))?;
    for row in rows.flatten() {
        strings.insert((row.0, row.1), row.2);
    }
    Ok(strings)
}

/// Résolution de chaîne de références pour les champs où toute la valeur est une ref.
/// Ex: "{20003,270001}(The Void)" → look up → "{20005,1007}(The Void)" → look up → "The Void".
/// À chaque étape on remplace tout par le résultat du lookup; on s'arrête dès qu'il n'y a plus de {.
pub(crate) fn resolve_ref_chain(raw: &str, strings: &HashMap<(i64, i64), String>) -> String {
    let mut current = raw.to_string();
    for _ in 0..8 {
        if let Some(start) = current.find('{') {
            if let Some(rel_end) = current[start..].find('}') {
                let inner = &current[start + 1..start + rel_end];
                if let Some((ps, ss)) = inner.split_once(',') {
                    if let (Ok(p), Ok(s)) = (ps.trim().parse::<i64>(), ss.trim().parse::<i64>()) {
                        if let Some(resolved) = strings.get(&(p, s)) {
                            current = resolved.clone();
                            continue;
                        }
                    }
                }
            }
        }
        break;
    }
    current
}

pub(crate) fn resolve_refs(input: &str, strings: &HashMap<(i64, i64), String>) -> String {
    let mut text = input.to_string();
    // Saved hint text from (pre-resolved hint){...} pattern — used as fallback.
    let mut hint: Option<String> = None;

    for _ in 0..4 {
        // X4 pattern: (pre-resolved hint){ref1}...
        // The '){' closes the hint; save it in case refs can't be resolved (e.g. DLC strings).
        if text.starts_with('(') {
            if let Some(p) = text.as_bytes().windows(2).position(|w| w == b"){") {
                if hint.is_none() {
                    hint = Some(text[1..p].to_string()); // strip outer parens
                }
                text = text[p + 1..].to_string();
            }
        }
        if !text.contains('{') { break; }
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars().peekable();
        let mut changed = false;
        while let Some(ch) = chars.next() {
            if ch == '{' {
                let mut buf = String::new();
                let mut ok = false;
                for c2 in chars.by_ref() {
                    if c2 == '}' { ok = true; break; }
                    buf.push(c2);
                }
                if ok {
                    if let Some((ps, ss)) = buf.split_once(',') {
                        if let (Ok(p), Ok(s)) = (ps.trim().parse::<i64>(), ss.trim().parse::<i64>()) {
                            if let Some(resolved) = strings.get(&(p, s)) {
                                out.push_str(resolved);
                                changed = true;
                                continue;
                            }
                        }
                    }
                    out.push('{'); out.push_str(&buf); out.push('}');
                } else {
                    out.push('{'); out.push_str(&buf);
                }
            } else {
                out.push(ch);
            }
        }
        text = out;
        if !changed { break; }
    }

    // If unresolved refs remain, use the saved hint (pre-resolved by the game).
    if text.contains('{') {
        if let Some(h) = hint {
            return h;
        }
    }

    // Handle \(short\)long escaped variant
    if text.starts_with("\\(") {
        if let Some(end) = text.find("\\)") {
            text = text[end + 2..].trim_start().to_string();
        }
    }
    text.replace("\\(", "(").replace("\\)", ")")
}