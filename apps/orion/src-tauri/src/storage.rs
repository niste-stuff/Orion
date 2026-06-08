//! Local JSON storage for the user's cards and the invisible sample store.
//!
//! Everything lives under `<appDataDir>/orion/`:
//!
//!   orion/cards/<uuid>.json            one file per user card
//!   orion/database/sets/<uuid>.json    one file per trained sample set (flat)
//!   orion/database/_index.json         tag -> sets / set -> meta (rebuildable cache)
//!
//! The `#[tauri::command]` wrappers only resolve the data dir and delegate to the
//! `core_*` functions, which are pure file I/O + index maintenance over a root
//! path (and unit-tested as such). Nothing logs card or sample contents, and no
//! command returns sample TEXT to the UI — the sample store is invisible to end
//! users (only metadata is ever surfaced).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static STORAGE_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------
// Paths / helpers (over a `root` = the `<appDataDir>/orion` directory)
// ---------------------------------------------------------------------------

/// `<appDataDir>/orion`. Created on demand by the callers that write into it.
fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("orion"))
}

fn cards_dir(root: &Path) -> PathBuf {
    root.join("cards")
}

fn sets_dir(root: &Path) -> PathBuf {
    root.join("database").join("sets")
}

fn index_path(root: &Path) -> PathBuf {
    root.join("database").join("_index.json")
}

fn ensure_dir(p: &Path) -> Result<(), String> {
    fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Write a JSON value pretty-printed, creating parent dirs as needed.
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// List `*.json` files in a directory; returns [] if the directory is absent.
fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            out.push(path);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct CardSummary {
    id: String,
    title: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

fn core_list_cards(root: &Path) -> Vec<CardSummary> {
    let mut cards: Vec<CardSummary> = Vec::new();
    for path in json_files(&cards_dir(root)) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(id) = value.get("id").and_then(Value::as_str) else { continue };
        cards.push(CardSummary {
            id: id.to_string(),
            title: value
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled")
                .to_string(),
            updated_at: value
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        });
    }
    cards.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    cards
}

fn core_load_card(root: &Path, id: &str) -> Result<Value, String> {
    let path = cards_dir(root).join(format!("{id}.json"));
    let text = fs::read_to_string(&path).map_err(|_| format!("card not found: {id}"))?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn core_save_card(root: &Path, card: &Value) -> Result<(), String> {
    let id = card
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("card is missing a non-empty id")?;
    write_json(&cards_dir(root).join(format!("{id}.json")), card)
}

/// Summaries of every saved card, newest-updated first.
#[tauri::command]
pub fn list_cards(app: AppHandle) -> Result<Vec<CardSummary>, String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(core_list_cards(&data_root(&app)?))
}

/// The full card file, returned untouched so the frontend owns the shape.
#[tauri::command]
pub fn load_card(app: AppHandle, id: String) -> Result<Value, String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    core_load_card(&data_root(&app)?, &id)
}

/// Write the whole card file. The card is forwarded verbatim; only `id` is read,
/// to name the file.
#[tauri::command]
pub fn save_card(app: AppHandle, card: Value) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    core_save_card(&data_root(&app)?, &card)
}

/// Delete a card file by its ID.
#[tauri::command]
pub fn delete_card(app: AppHandle, id: String) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = cards_dir(&data_root(&app)?).join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Sample sets (the invisible store)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct SampleTag {
    tag: String,
    #[serde(rename = "type")]
    tag_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Sample {
    section: String,
    text: String,
}

#[derive(Serialize, Deserialize)]
pub struct SampleSet {
    id: String,
    name: String,
    slug: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    tags: Vec<SampleTag>,
    samples: Vec<Sample>,
}

const MAX_SAMPLES: usize = 20;

/// Write a sample set file and refresh the index. If a set with this id already
/// exists, the incoming samples are APPENDED (the frontend can never read the
/// store's text, so appends must happen here); metadata (name/slug/tags) comes
/// from the incoming set and the original createdAt is preserved.
fn core_save_sample_set(root: &Path, set: SampleSet) -> Result<(), String> {
    if set.id.is_empty() {
        return Err("sample set is missing a non-empty id".into());
    }
    let path = sets_dir(root).join(format!("{}.json", set.id));

    let merged = if let Ok(text) = fs::read_to_string(&path) {
        let existing: SampleSet = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let mut samples = existing.samples;
        samples.extend(set.samples);
        SampleSet {
            id: set.id,
            name: set.name,
            slug: set.slug,
            created_at: existing.created_at,
            updated_at: set.updated_at,
            tags: set.tags,
            samples,
        }
    } else {
        set
    };

    if merged.samples.is_empty() || merged.samples.len() > MAX_SAMPLES {
        return Err(format!(
            "a sample set must hold between 1 and {MAX_SAMPLES} samples"
        ));
    }

    write_json(&path, &merged)?;
    core_rebuild_index(root)
}

#[derive(Serialize)]
pub struct SampleSetSummary {
    id: String,
    name: String,
    slug: String,
    tags: Vec<SampleTag>,
    #[serde(rename = "sampleCount")]
    sample_count: usize,
}

fn core_list_my_sample_sets(root: &Path) -> Vec<SampleSetSummary> {
    let mut sets: Vec<SampleSetSummary> = Vec::new();
    for path in json_files(&sets_dir(root)) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(set) = serde_json::from_str::<SampleSet>(&text) else { continue };
        sets.push(SampleSetSummary {
            id: set.id,
            name: set.name,
            slug: set.slug,
            tags: set.tags,
            sample_count: set.samples.len(),
        });
    }
    sets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    sets
}

/// Write a sample set file and refresh the index.
#[tauri::command]
pub fn save_sample_set(app: AppHandle, set: SampleSet) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    core_save_sample_set(&data_root(&app)?, set)
}

/// Metadata for every sample set — FOR THE TRAINER ONLY. Never returns sample
/// text; the Trainer may show name/slug/tags/count and nothing more.
#[tauri::command]
pub fn list_my_sample_sets(app: AppHandle) -> Result<Vec<SampleSetSummary>, String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(core_list_my_sample_sets(&data_root(&app)?))
}

// ---------------------------------------------------------------------------
// Index (rebuildable cache — never the source of truth)
// ---------------------------------------------------------------------------

#[derive(Serialize, Default)]
struct TagEntry {
    #[serde(rename = "type")]
    tag_type: String,
    sets: Vec<String>,
}

#[derive(Serialize)]
struct SetEntry {
    name: String,
    slug: String,
    tags: Vec<SampleTag>,
    #[serde(rename = "sampleCount")]
    sample_count: usize,
}

#[derive(Serialize, Default)]
struct Index {
    tags: BTreeMap<String, TagEntry>,
    sets: BTreeMap<String, SetEntry>,
}

/// Regenerate the index purely from the set files on disk. The previous index is
/// never read (it is only a cache), so a missing/empty/corrupt index self-heals;
/// individual corrupt set files are skipped.
fn core_rebuild_index(root: &Path) -> Result<(), String> {
    let mut index = Index::default();

    for path in json_files(&sets_dir(root)) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(set) = serde_json::from_str::<SampleSet>(&text) else { continue };

        for tag in &set.tags {
            let entry = index.tags.entry(tag.tag.clone()).or_default();
            entry.tag_type = tag.tag_type.clone();
            if !entry.sets.contains(&set.id) {
                entry.sets.push(set.id.clone());
            }
        }

        index.sets.insert(
            set.id.clone(),
            SetEntry {
                name: set.name,
                slug: set.slug,
                tags: set.tags,
                sample_count: set.samples.len(),
            },
        );
    }

    write_json(&index_path(root), &index)
}

/// Rescan `database/sets/` and regenerate `_index.json`. The backbone of manual
/// file management: set files dropped in by hand become known after this.
#[tauri::command]
pub fn rebuild_index(app: AppHandle) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    core_rebuild_index(&data_root(&app)?)
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/// Open `<appDataDir>/orion` in the OS file manager so the user can drop set
/// files in by hand (then call rebuild_index). Creates the folder if absent.
#[tauri::command]
pub fn reveal_data_dir(app: AppHandle) -> Result<(), String> {
    let root = data_root(&app)?;
    ensure_dir(&root)?;

    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(&root)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Retrieval: tag -> sets -> weighted, section-aware sample selection
//
// This is the ONLY place sample TEXT is read, and it never crosses to the
// frontend: build_style_reference_for returns a formatted prompt block that the
// LLM command splices into the system message before POSTing. The UI never sees
// it. Any read/parse failure returns None (silent no-retrieval).
// ---------------------------------------------------------------------------

/// A parsed tag with its emphasis weight, sent from the frontend.
#[derive(Deserialize, Clone)]
pub struct WeightedTag {
    pub tag: String,
    pub weight: f64,
}

/// Total injected samples are capped at this across all sets.
const SAMPLE_CAP: usize = 7;

#[derive(Deserialize)]
struct IndexTagEntry {
    #[serde(rename = "type")]
    tag_type: String,
    sets: Vec<String>,
}

#[derive(Deserialize, Default)]
struct IndexFile {
    #[serde(default)]
    tags: BTreeMap<String, IndexTagEntry>,
}

struct ResolvedSet {
    name: String,
    weight: f64,
    is_quality: bool,
    /// Samples pre-sorted by section priority (active, then general, then other).
    samples: Vec<Sample>,
}

/// 0 = the section being edited, 1 = general (filler), 2 = any other section.
fn section_priority(section: &str, active: &str) -> u8 {
    if section == active {
        0
    } else if section == "general" {
        1
    } else {
        2
    }
}

/// Largest gap allowed between weights for slot distribution ONLY. A spread wider
/// than this is treated as if it were this wide, so one big weight can't zero the
/// rest. The instruction layer still conveys the user's true relative intent.
const MAX_DISTRIBUTION_RATIO: f64 = 5.0;

/// Lift tiny weights to at least `max/max_ratio` so the spread used for slot math
/// is at most `max_ratio:1`. Returns the (effective) weights for distribution.
fn clamp_ratio(weights: &[f64], max_ratio: f64) -> Vec<f64> {
    let max = weights.iter().cloned().fold(0.0_f64, f64::max);
    if max <= 0.0 || max_ratio <= 0.0 {
        return weights.to_vec();
    }
    let floor = max / max_ratio;
    weights.iter().map(|&w| w.max(floor)).collect()
}

/// Distribute `cap` slots across sets proportional to weight (largest-remainder).
///
/// Two starvation guards:
/// - the spread is ratio-clamped (A2) so one large weight can't zero the rest;
/// - when the budget allows (distinct sets <= cap), EVERY explicitly-requested set
///   gets >=1 slot (A1) — borrowing from the lowest-weight set with slots to spare.
///   With more sets than slots, only weight>=1.0 sets are guaranteed; the rest may
///   get 0, which is acceptable.
///
/// `prefer` is a tie-break order (most-preferred first) for remainder assignment.
fn distribute_slots(weights: &[f64], cap: usize, prefer: &[usize]) -> Vec<usize> {
    let n = weights.len();
    if n == 0 || cap == 0 {
        return vec![0; n];
    }

    let mut rank = vec![usize::MAX; n];
    for (pos, &i) in prefer.iter().enumerate() {
        if i < n {
            rank[i] = pos;
        }
    }

    // A2: slot math uses ratio-clamped weights (raw weights are unchanged for the
    // instruction layer).
    let eff = clamp_ratio(weights, MAX_DISTRIBUTION_RATIO);
    let sum: f64 = eff.iter().sum();
    let mut slots = vec![0usize; n];

    if sum <= 0.0 {
        // No weight signal: hand slots out in preference order.
        let mut given = 0;
        for &i in prefer {
            if given >= cap {
                break;
            }
            if i < n {
                slots[i] += 1;
                given += 1;
            }
        }
        return slots;
    }

    let shares: Vec<f64> = eff.iter().map(|w| w / sum * cap as f64).collect();
    for i in 0..n {
        slots[i] = shares[i].floor() as usize;
    }
    let remainder = cap.saturating_sub(slots.iter().sum());

    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| {
        let fa = shares[a] - shares[a].floor();
        let fb = shares[b] - shares[b].floor();
        fb.partial_cmp(&fa)
            .unwrap_or(Ordering::Equal)
            .then(rank[a].cmp(&rank[b]))
            .then(a.cmp(&b))
    });
    for &i in idx.iter().take(remainder) {
        slots[i] += 1;
    }

    // A1: guarantee a slot to starved sets — every set when the budget allows
    // (n <= cap), otherwise only weight>=1.0 sets — by borrowing from the
    // lowest-weight set that has a slot to spare.
    let guarantee_all = n <= cap;
    loop {
        let Some(needy) =
            (0..n).find(|&i| slots[i] == 0 && (guarantee_all || weights[i] >= 1.0))
        else {
            break;
        };
        let donor = (0..n).filter(|&i| slots[i] > 1).min_by(|&a, &b| {
            weights[a]
                .partial_cmp(&weights[b])
                .unwrap_or(Ordering::Equal)
                .then(b.cmp(&a))
        });
        let Some(donor) = donor else { break };
        slots[donor] -= 1;
        slots[needy] += 1;
    }

    slots
}

/// Choose up to `cap` samples across the resolved sets. Returns (set, sample)
/// index pairs in injection order. Weight drives the count; section priority
/// orders within a set; quality-tagged sets are preferred only when no quality
/// tag was requested.
fn select_samples(resolved: &[ResolvedSet], has_quality_tag: bool, cap: usize) -> Vec<(usize, usize)> {
    let n = resolved.len();
    if n == 0 {
        return Vec::new();
    }

    let mut prefer: Vec<usize> = (0..n).collect();
    prefer.sort_by(|&a, &b| {
        if !has_quality_tag {
            let (qa, qb) = (resolved[a].is_quality, resolved[b].is_quality);
            if qa != qb {
                return qb.cmp(&qa); // quality first
            }
        }
        resolved[b]
            .weight
            .partial_cmp(&resolved[a].weight)
            .unwrap_or(Ordering::Equal)
            .then(a.cmp(&b))
    });

    let weights: Vec<f64> = resolved.iter().map(|r| r.weight).collect();
    let mut slots = distribute_slots(&weights, cap, &prefer);

    // Cap each set by what it actually has.
    for i in 0..n {
        slots[i] = slots[i].min(resolved[i].samples.len());
    }

    // Redistribute any freed budget to sets with spare capacity (preferred first).
    let mut leftover = cap.saturating_sub(slots.iter().sum());
    while leftover > 0 {
        let mut progressed = false;
        for &i in &prefer {
            if leftover == 0 {
                break;
            }
            if slots[i] < resolved[i].samples.len() {
                slots[i] += 1;
                leftover -= 1;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }

    let mut out = Vec::new();
    for &i in &prefer {
        for j in 0..slots[i] {
            out.push((i, j));
        }
    }
    out
}

/// Format the selected samples into the system-prompt reference block. The
/// governing rules come FIRST, before the labeled samples, in this order:
/// ranked hierarchy -> normalize-not-percentages -> coherence -> anti-homogenization.
/// Weights become a RANKED HIERARCHY (primary/secondary/light), never raw floats,
/// so the model treats them as relative emphasis rather than precise magnitudes.
fn format_reference(
    resolved: &[ResolvedSet],
    selection: &[(usize, usize)],
    active_section: &str,
) -> String {
    // Distinct contributing sets, in injection order.
    let mut order: Vec<usize> = Vec::new();
    for &(si, _) in selection {
        if !order.contains(&si) {
            order.push(si);
        }
    }

    // Rank heaviest-first (ties keep injection order); labels are normalized
    // against the heaviest weight — we never print the raw float magnitudes.
    let mut ranked = order.clone();
    ranked.sort_by(|&a, &b| {
        resolved[b]
            .weight
            .partial_cmp(&resolved[a].weight)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                let pa = order.iter().position(|&x| x == a).unwrap_or(0);
                let pb = order.iter().position(|&x| x == b).unwrap_or(0);
                pa.cmp(&pb)
            })
    });
    let max_w = ranked
        .iter()
        .map(|&i| resolved[i].weight)
        .fold(0.0_f64, f64::max)
        .max(f64::MIN_POSITIVE);
    let hierarchy: Vec<String> = ranked
        .iter()
        .enumerate()
        .map(|(pos, &i)| {
            let r = &resolved[i];
            let ratio = r.weight / max_w;
            let lead = if pos == 0 {
                "lean hardest on"
            } else if ratio >= 0.66 {
                "draw strongly on"
            } else if ratio >= 0.33 {
                "draw moderately on"
            } else {
                "lightly reference"
            };
            format!("{lead} '{}'", r.name)
        })
        .collect();

    let mut out = String::new();
    out.push_str("=== STYLE REFERENCE (emulate; do not copy) ===\n");
    out.push_str(&format!(
        "You are authoring the \"{active_section}\" section of a character card. The passages below are STYLE REFERENCES to learn from for this section.\n"
    ));
    out.push_str(&format!(
        "Style hierarchy (most to least important): {}.\n",
        hierarchy.join("; ")
    ));
    out.push_str(
        "Treat the above as a HIERARCHY OF IMPORTANCE, normalized relative to one another — not exact percentages.\n",
    );
    out.push_str(
        "Above all, produce a single coherent character in one unified voice. When the referenced styles conflict or pull in different directions, BLEND them into one consistent voice — do NOT alternate between styles, switch tone mid-passage, or average them into something incoherent. Coherence of the result outranks faithfully hitting every emphasis.\n",
    );
    out.push_str(
        "Emulate the STRUCTURE, VOICE, and STYLE of these references, but do NOT reuse their specific characters, names, or premises — produce something new in that style. These are references to emulate, NOT content to copy verbatim, NOT conversation, and NOT the card's own data.\n\n",
    );
    for (n, &(si, sj)) in selection.iter().enumerate() {
        let s = &resolved[si].samples[sj];
        out.push_str(&format!("[reference {} · {}]\n{}\n\n", n + 1, s.section, s.text.trim()));
    }
    out.push_str("=== END STYLE REFERENCE ===");
    out
}

/// Resolve tags against the index, select weighted section-aware samples, and
/// build the reference block. None on any failure or a miss (silent).
fn core_build_style_reference(
    root: &Path,
    tags: &[WeightedTag],
    active_section: &str,
) -> Option<String> {
    if tags.is_empty() {
        return None;
    }
    let text = fs::read_to_string(index_path(root)).ok()?;
    let index: IndexFile = serde_json::from_str(&text).ok()?;

    // Resolve POSITIVE tags only. HOOK (future build): negative/anti-reference
    // tags (e.g. [-tag]) and an explicit low-quality "trash" convention would be
    // handled here — collecting an exclusion set to down-rank or filter out — and
    // are intentionally NOT implemented yet. Untagged sets stay neutral, never
    // trash; low quality is opt-in only.
    // Resolve: set id -> max reaching weight (stable first-seen order).
    let mut set_weight: BTreeMap<String, f64> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut has_quality_tag = false;
    for wt in tags {
        let tag = wt.tag.to_lowercase();
        let Some(entry) = index.tags.get(&tag) else { continue };
        if entry.tag_type == "quality" {
            has_quality_tag = true;
        }
        for sid in &entry.sets {
            match set_weight.get_mut(sid) {
                Some(w) => {
                    if wt.weight > *w {
                        *w = wt.weight;
                    }
                }
                None => {
                    set_weight.insert(sid.clone(), wt.weight);
                    order.push(sid.clone());
                }
            }
        }
    }
    if order.is_empty() {
        return None;
    }

    // Load the resolved set files; skip unreadable/corrupt ones.
    let mut resolved: Vec<ResolvedSet> = Vec::new();
    for sid in &order {
        let path = sets_dir(root).join(format!("{sid}.json"));
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(set) = serde_json::from_str::<SampleSet>(&text) else { continue };
        let weight = *set_weight.get(sid).unwrap_or(&1.0);
        let is_quality = set.tags.iter().any(|t| t.tag_type == "quality");
        let mut samples = set.samples;
        samples.sort_by_key(|s| section_priority(&s.section, active_section));
        resolved.push(ResolvedSet { name: set.name, weight, is_quality, samples });
    }
    if resolved.is_empty() {
        return None;
    }

    let selection = select_samples(&resolved, has_quality_tag, SAMPLE_CAP);
    if selection.is_empty() {
        return None;
    }
    Some(format_reference(&resolved, &selection, active_section))
}

/// App-facing entry: resolve the data dir and build the reference block, or None.
/// Never errors — retrieval is best-effort and silent.
pub fn build_style_reference_for(
    app: &AppHandle,
    tags: &[WeightedTag],
    active_section: &str,
) -> Option<String> {
    let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = data_root(app).ok()?;
    core_build_style_reference(&root, tags, active_section)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_root() -> PathBuf {
        let mut p = std::env::temp_dir();
        let unique = format!(
            "orion-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        p.push(unique);
        p
    }

    fn read_index(root: &Path) -> Value {
        let text = fs::read_to_string(index_path(root)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn sample_set(id: &str, samples: Vec<Sample>) -> SampleSet {
        SampleSet {
            id: id.into(),
            name: "Elias".into(),
            slug: "elias".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            tags: vec![
                SampleTag { tag: "elias".into(), tag_type: "creator".into() },
                SampleTag { tag: "netori".into(), tag_type: "genre".into() },
            ],
            samples,
        }
    }

    fn s(section: &str, text: &str) -> Sample {
        Sample { section: section.into(), text: text.into() }
    }

    #[test]
    fn card_save_load_roundtrips_all_six_sections() {
        let root = tmp_root();
        let card = json!({
            "id": "card-1",
            "title": "Knight",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
            "sections": {
                "personality": "brave",
                "scenario": "a keep",
                "dialogue_examples": "\"Hold!\"",
                "storefront": "click me",
                "opening_messages": ["one", "two", "three"],
                "lorebook": { "enabled": true, "text": "world facts" }
            }
        });
        core_save_card(&root, &card).unwrap();
        let loaded = core_load_card(&root, "card-1").unwrap();
        assert_eq!(loaded, card, "card file must round-trip byte-for-value");
        // File is named by id.
        assert!(cards_dir(&root).join("card-1.json").exists());
    }

    #[test]
    fn list_cards_sorts_newest_first_and_reads_title() {
        let root = tmp_root();
        core_save_card(&root, &json!({ "id": "a", "title": "Older", "updatedAt": "2026-01-01T00:00:00Z" })).unwrap();
        core_save_card(&root, &json!({ "id": "b", "title": "Newer", "updatedAt": "2026-02-01T00:00:00Z" })).unwrap();
        let list = core_list_cards(&root);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "b");
        assert_eq!(list[0].title, "Newer");
        assert_eq!(list[1].id, "a");
    }

    #[test]
    fn save_card_requires_id() {
        let root = tmp_root();
        assert!(core_save_card(&root, &json!({ "title": "no id" })).is_err());
        assert!(core_save_card(&root, &json!({ "id": "" })).is_err());
    }

    #[test]
    fn missing_dirs_return_empty_not_error() {
        let root = tmp_root(); // never created
        assert!(core_list_cards(&root).is_empty());
        assert!(core_list_my_sample_sets(&root).is_empty());
        assert!(core_load_card(&root, "nope").is_err());
    }

    #[test]
    fn sample_set_writes_uuid_file_and_updates_index() {
        let root = tmp_root();
        core_save_sample_set(&root, sample_set("uuid-a", vec![s("personality", "p"), s("scenario", "sc")])).unwrap();

        // File is named by uuid (the id), under database/sets/.
        assert!(sets_dir(&root).join("uuid-a.json").exists());

        // Metadata only — count is 2, and the on-disk file carries the exact shape.
        let summaries = core_list_my_sample_sets(&root);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "uuid-a");
        assert_eq!(summaries[0].slug, "elias");
        assert_eq!(summaries[0].sample_count, 2);

        // Index: tag -> {type, sets} and set -> metadata.
        let idx = read_index(&root);
        assert_eq!(idx["tags"]["netori"]["type"], "genre");
        assert_eq!(idx["tags"]["netori"]["sets"][0], "uuid-a");
        assert_eq!(idx["tags"]["elias"]["type"], "creator");
        assert_eq!(idx["sets"]["uuid-a"]["name"], "Elias");
        assert_eq!(idx["sets"]["uuid-a"]["slug"], "elias");
        assert_eq!(idx["sets"]["uuid-a"]["sampleCount"], 2);
    }

    #[test]
    fn saving_existing_set_appends_and_preserves_created_at() {
        let root = tmp_root();
        core_save_sample_set(&root, sample_set("uuid-a", vec![s("personality", "first")])).unwrap();

        // Append two more with a later updatedAt.
        let mut more = sample_set("uuid-a", vec![s("scenario", "second"), s("lorebook", "third")]);
        more.updated_at = "2026-03-03T00:00:00Z".into();
        core_save_sample_set(&root, more).unwrap();

        let on_disk: SampleSet =
            serde_json::from_str(&fs::read_to_string(sets_dir(&root).join("uuid-a.json")).unwrap()).unwrap();
        assert_eq!(on_disk.samples.len(), 3, "samples appended, not overwritten");
        assert_eq!(on_disk.created_at, "2026-01-01T00:00:00Z", "createdAt preserved");
        assert_eq!(on_disk.updated_at, "2026-03-03T00:00:00Z", "updatedAt advanced");
        assert_eq!(core_list_my_sample_sets(&root)[0].sample_count, 3);
    }

    #[test]
    fn sample_count_cap_enforced() {
        let root = tmp_root();
        // 21 in one shot is rejected.
        let many: Vec<Sample> = (0..21).map(|i| s("general", &format!("x{i}"))).collect();
        assert!(core_save_sample_set(&root, sample_set("big", many)).is_err());

        // 20 ok, then appending one more (→21) is rejected and the file is unchanged.
        let twenty: Vec<Sample> = (0..20).map(|i| s("general", &format!("x{i}"))).collect();
        core_save_sample_set(&root, sample_set("cap", twenty)).unwrap();
        assert!(core_save_sample_set(&root, sample_set("cap", vec![s("general", "overflow")])).is_err());
        assert_eq!(core_list_my_sample_sets(&root)[0].sample_count, 20);
    }

    #[test]
    fn empty_sample_set_rejected() {
        let root = tmp_root();
        assert!(core_save_sample_set(&root, sample_set("empty", vec![])).is_err());
    }

    #[test]
    fn rebuild_index_from_hand_dropped_file_only() {
        let root = tmp_root();
        // Hand-place a set file directly (as if dropped in via the data folder).
        let dir = sets_dir(&root);
        ensure_dir(&dir).unwrap();
        let dropped = sample_set("dropped", vec![s("personality", "p")]);
        write_json(&dir.join("dropped.json"), &dropped).unwrap();

        // Not in the index yet (no save went through).
        assert!(fs::read_to_string(index_path(&root)).is_err());

        // Rebuild discovers it from the sets folder alone.
        core_rebuild_index(&root).unwrap();
        let idx = read_index(&root);
        assert_eq!(idx["sets"]["dropped"]["name"], "Elias");
        assert_eq!(idx["tags"]["elias"]["sets"][0], "dropped");
    }

    #[test]
    fn rebuild_is_robust_to_corrupt_index_and_files() {
        let root = tmp_root();
        let dir = sets_dir(&root);
        ensure_dir(&dir).unwrap();
        // A valid set, a corrupt set file, and a corrupt pre-existing index.
        write_json(&dir.join("good.json"), &sample_set("good", vec![s("general", "g")])).unwrap();
        fs::write(dir.join("broken.json"), "{ not json").unwrap();
        ensure_dir(index_path(&root).parent().unwrap()).unwrap();
        fs::write(index_path(&root), "}}garbage").unwrap();

        core_rebuild_index(&root).unwrap();
        let idx = read_index(&root);
        assert!(idx["sets"].get("good").is_some());
        assert!(idx["sets"].get("broken").is_none(), "corrupt set skipped");
        // list also skips the corrupt file without crashing.
        assert_eq!(core_list_my_sample_sets(&root).len(), 1);
    }

    // --- retrieval / selection math ---

    fn rs(name: &str, weight: f64, is_quality: bool, sections: &[&str]) -> ResolvedSet {
        ResolvedSet {
            name: name.into(),
            weight,
            is_quality,
            samples: sections
                .iter()
                .map(|sec| Sample { section: sec.to_string(), text: format!("{name}:{sec}") })
                .collect(),
        }
    }

    fn wt(tag: &str, weight: f64) -> WeightedTag {
        WeightedTag { tag: tag.into(), weight }
    }

    #[test]
    fn distribute_is_proportional_and_capped() {
        let slots = distribute_slots(&[3.0, 1.0], 7, &[0, 1]);
        assert_eq!(slots, vec![5, 2]); // 5.25 vs 1.75
        assert_eq!(slots.iter().sum::<usize>(), 7);
    }

    #[test]
    fn distribute_guarantees_min_one_when_a_donor_exists() {
        let slots = distribute_slots(&[4.0, 1.0, 1.0, 1.0, 1.0, 1.0], 7, &[0, 1, 2, 3, 4, 5]);
        assert_eq!(slots.iter().sum::<usize>(), 7);
        for i in 1..6 {
            assert!(slots[i] >= 1, "unit-weight set {i} starved: {slots:?}");
        }
    }

    #[test]
    fn distribute_remainder_tiebreak_follows_prefer() {
        // Equal weights → one remainder slot; prefer index 1, so it wins the tie.
        assert_eq!(distribute_slots(&[1.0, 1.0], 7, &[1, 0]), vec![3, 4]);
    }

    #[test]
    fn distribute_does_not_starve_low_weight_explicit_tag() {
        // Extreme ratio, budget allows (2 sets <= 7): the 0.1 set still gets >=1.
        let slots = distribute_slots(&[2.0, 0.1], 7, &[0, 1]);
        assert_eq!(slots.iter().sum::<usize>(), 7);
        assert!(slots[1] >= 1, "explicit low-weight set starved: {slots:?}");
    }

    #[test]
    fn distribute_clamps_extreme_ratio_across_many_sets() {
        let slots = distribute_slots(&[2.0, 0.1, 0.1, 0.1], 7, &[0, 1, 2, 3]);
        assert_eq!(slots.iter().sum::<usize>(), 7);
        for i in 0..4 {
            assert!(slots[i] >= 1, "set {i} starved: {slots:?}");
        }
        assert!(slots[0] >= slots[1], "the big set should still lead: {slots:?}");
    }

    #[test]
    fn distribute_single_tag_is_unchanged() {
        assert_eq!(distribute_slots(&[1.5], 7, &[0]), vec![7]);
        assert_eq!(distribute_slots(&[0.1], 7, &[0]), vec![7]);
    }

    #[test]
    fn distribute_similar_weights_unaffected_by_clamp() {
        // 3:1 is within the 5:1 clamp → plain proportional result, unchanged.
        assert_eq!(distribute_slots(&[3.0, 1.0], 7, &[0, 1]), vec![5, 2]);
    }

    #[test]
    fn distribute_more_sets_than_slots_may_drop_lowest() {
        let mut w = vec![2.0; 7];
        w.push(0.1); // 8 sets > cap
        let prefer: Vec<usize> = (0..8).collect();
        let slots = distribute_slots(&w, 7, &prefer);
        assert_eq!(slots.iter().sum::<usize>(), 7);
        assert_eq!(slots[7], 0, "with >7 sets the lowest-weight set may get 0");
    }

    #[test]
    fn select_never_exceeds_cap() {
        let sets = vec![
            rs("A", 1.0, false, &["general"; 5]),
            rs("B", 1.0, false, &["general"; 5]),
            rs("C", 1.0, false, &["general"; 5]),
        ];
        assert_eq!(select_samples(&sets, false, 7).len(), 7);
    }

    #[test]
    fn select_injects_fewer_when_few_candidates() {
        let sets = vec![rs("A", 1.0, false, &["general", "general"])];
        assert_eq!(select_samples(&sets, false, 7).len(), 2);
    }

    #[test]
    fn select_ranks_quality_above_when_no_quality_tag() {
        // Equal weight; B is quality-tagged. With no quality tag requested, B
        // should get at least as many (and here strictly more via the tie-break).
        let sets = vec![
            rs("A", 1.0, false, &["general"; 5]),
            rs("B", 1.0, true, &["general"; 5]),
        ];
        let sel = select_samples(&sets, false, 7);
        let a = sel.iter().filter(|(si, _)| *si == 0).count();
        let b = sel.iter().filter(|(si, _)| *si == 1).count();
        assert_eq!(sel.len(), 7);
        assert!(b > a, "quality set B={b} should outrank A={a}");
    }

    #[test]
    fn retrieval_end_to_end_active_section_first_and_labels() {
        let root = tmp_root();
        // One creator set "Elias" with personality / general / scenario samples.
        let set = SampleSet {
            id: "uuid-1".into(),
            name: "Elias".into(),
            slug: "elias".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            tags: vec![SampleTag { tag: "elias".into(), tag_type: "creator".into() }],
            samples: vec![s("scenario", "SC-text"), s("personality", "P-text"), s("general", "G-text")],
        };
        core_save_sample_set(&root, set).unwrap();

        let block = core_build_style_reference(&root, &[wt("elias", 0.8)], "personality").unwrap();
        assert!(block.contains("STYLE REFERENCE"));
        assert!(block.contains("do NOT reuse their specific characters"));
        // Ranked hierarchy (not a raw float) + coherence directive.
        assert!(block.contains("lean hardest on 'Elias'"));
        assert!(block.contains("HIERARCHY OF IMPORTANCE"));
        assert!(block.contains("single coherent character"));
        assert!(!block.contains("0.8"), "raw weight floats must not be printed");
        // Active-section sample (personality) precedes the other-section one.
        let p = block.find("P-text").unwrap();
        let sc = block.find("SC-text").unwrap();
        assert!(p < sc, "active-section sample must come first");
    }

    #[test]
    fn reference_block_hierarchy_coherence_and_rules_before_samples() {
        let resolved = vec![
            rs("Primary", 1.6, false, &["personality"]),
            rs("Light", 0.4, false, &["personality"]),
        ];
        let selection = vec![(0, 0), (1, 0)];
        let block = format_reference(&resolved, &selection, "personality");

        // Ranked hierarchy, normalized language, no raw float magnitudes.
        assert!(block.contains("lean hardest on 'Primary'"));
        assert!(block.contains("'Light'"));
        assert!(block.contains("HIERARCHY OF IMPORTANCE"));
        assert!(!block.contains("1.6") && !block.contains("0.4"));
        // Coherence directive + preserved anti-homogenization.
        assert!(block.contains("BLEND them into one consistent voice"));
        assert!(block.contains("Coherence of the result outranks"));
        assert!(block.contains("do NOT reuse their specific characters"));
        // Governing rules precede the reference samples.
        let rules = block.find("BLEND them").unwrap();
        let first_sample = block.find("[reference 1").unwrap();
        assert!(rules < first_sample, "rules must come before samples");
    }

    #[test]
    fn retrieval_caps_at_seven_references() {
        let root = tmp_root();
        let many: Vec<Sample> = (0..10).map(|i| s("general", &format!("g{i}"))).collect();
        core_save_sample_set(&root, sample_set("big", many)).unwrap();
        let block = core_build_style_reference(&root, &[wt("elias", 1.0)], "personality").unwrap();
        assert_eq!(block.matches("[reference ").count(), 7);
    }

    #[test]
    fn retrieval_misses_are_silent_none() {
        let root = tmp_root();
        // No index yet.
        assert!(core_build_style_reference(&root, &[wt("x", 1.0)], "personality").is_none());
        // Known store, unknown tag → nothing.
        core_save_sample_set(&root, sample_set("u1", vec![s("general", "g")])).unwrap();
        assert!(core_build_style_reference(&root, &[wt("nope", 1.0)], "personality").is_none());
        // Empty tags → nothing.
        assert!(core_build_style_reference(&root, &[], "personality").is_none());
    }
}
