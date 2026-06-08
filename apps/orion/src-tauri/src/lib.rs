mod llm;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      llm::llm_chat_completion,
      llm::llm_authoring_completion,
      llm::llm_list_models,
      storage::list_cards,
      storage::load_card,
      storage::save_card,
      storage::delete_card,
      storage::save_sample_set,
      storage::list_my_sample_sets,
      storage::rebuild_index,
      storage::reveal_data_dir
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
