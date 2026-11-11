import { invoke } from '@tauri-apps/api/core'

export function loadMeta() {
  return invoke('load_meta')
}

export function getBody(id) {
  return invoke('get_body', { id })
}

export function saveDiary(diary) {
  return invoke('save_diary', { diary })
}

export function deleteDiary(id) {
  return invoke('delete_diary', { id })
}

export function searchDiaries(query) {
  return invoke('search_diaries', { query })
}

export function loadConfig() {
  return invoke('load_config')
}

export function saveConfig(config) {
  return invoke('save_config', { config })
}

export function getDataDir() {
  return invoke('get_data_dir')
}

export function getDataDirSize() {
  return invoke('data_dir_size')
}

export function setDataDir(path, mode = 'migrate') {
  return invoke('set_data_dir', { path, mode })
}

export function inspectDataDir(path) {
  return invoke('inspect_data_dir', { path })
}

export function writeTextFile(path, content) {
  return invoke('write_text_file', { path, content })
}

export function removeDataDir(path) {
  return invoke('remove_data_dir', { path })
}

export function listEmptyDirs() {
  return invoke('list_empty_dirs')
}

export function removeEmptyDirs() {
  return invoke('remove_empty_dirs')
}
