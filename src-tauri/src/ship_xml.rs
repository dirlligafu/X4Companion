//! Extraction à la demande du sous-arbre XML d'un vaisseau joueur (équivalent logique à x4-save-miner -X).

use flate2::read::GzDecoder;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;
use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::Path;

fn is_target_player_ship(start: &BytesStart<'_>, target_code: &str) -> bool {
    let mut class_ok = false;
    let mut owner_ok = false;
    let mut code_ok = false;
    for attr in start.attributes().flatten() {
        let k = attr.key.as_ref();
        let v = attr.value.as_ref();
        if k == b"class" {
            class_ok = std::str::from_utf8(v)
                .map(|s| s.starts_with("ship_"))
                .unwrap_or(false);
        } else if k == b"owner" {
            owner_ok = v == b"player";
        } else if k == b"code" {
            code_ok = std::str::from_utf8(v)
                .map(|s| s == target_code)
                .unwrap_or(false);
        }
    }
    class_ok && owner_ok && code_ok
}

/// Lit la save (xml ou gz), trouve le premier `<component class="ship_*" owner="player" code="…">`
/// et renvoie sa sérialisation XML (sous-arbre complet, comme `etree.tostring` côté Python).
pub fn extract_player_ship_subtree(save_path: &str, ship_code: &str) -> Result<String, String> {
    let path = Path::new(save_path);
    if !path.is_file() {
        return Err("Fichier de sauvegarde introuvable.".to_string());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;

    let reader_inner: Box<dyn std::io::BufRead> = if save_path.ends_with(".gz") {
        Box::new(BufReader::new(GzDecoder::new(file)))
    } else {
        Box::new(BufReader::new(file))
    };

    let mut reader = Reader::from_reader(reader_inner);
    reader.config_mut().trim_text(false);

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(Vec::<u8>::new());
    let mut writer = Writer::new(&mut cursor);
    let mut comp_depth: u32 = 0;

    loop {
        let ev = reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("Erreur XML : {e}"))?;

        match ev {
            Event::Eof => break,
            Event::Start(e) if e.name().as_ref() == b"component" => {
                if comp_depth == 0 {
                    if is_target_player_ship(&e, ship_code) {
                        comp_depth = 1;
                        writer
                            .write_event(Event::Start(e.into_owned()))
                            .map_err(|e| e.to_string())?;
                    }
                } else {
                    comp_depth += 1;
                    writer
                        .write_event(Event::Start(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                }
            }
            Event::End(e) if e.name().as_ref() == b"component" => {
                if comp_depth > 0 {
                    comp_depth -= 1;
                    writer
                        .write_event(Event::End(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                    if comp_depth == 0 {
                        break;
                    }
                }
            }
            Event::Empty(e) if e.name().as_ref() == b"component" => {
                if comp_depth > 0 {
                    writer
                        .write_event(Event::Empty(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                } else if is_target_player_ship(&e, ship_code) {
                    writer
                        .write_event(Event::Empty(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                    break;
                }
            }
            ev => {
                if comp_depth > 0 {
                    writer.write_event(ev).map_err(|e| e.to_string())?;
                }
            }
        }
        buf.clear();
    }

    drop(writer);
    let written = cursor.into_inner();
    if written.is_empty() {
        return Err(format!(
            "Aucun vaisseau joueur trouvé avec le code « {ship_code} » (vérifiez le code ou le fichier)."
        ));
    }

    String::from_utf8(written).map_err(|e| format!("UTF-8 invalide dans le fragment : {e}"))
}
