// Lưu/đọc danh sách công việc và cài đặt trong localStorage của trình duyệt.
const Storage = (() => {
  const TASKS_KEY = "todo.tasks.v1";
  const THEME_KEY = "todo.theme";

  const NOTES_KEY = "todo.notes.v1";

  // Danh sách bản ghi (việc / ghi chú) lưu dạng JSON
  function loadList(key) {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (err) {
      console.error("Không lưu được dữ liệu:", err);
    }
  }

  const loadTasks = () => loadList(TASKS_KEY);
  const saveTasks = (tasks) => saveList(TASKS_KEY, tasks);
  const loadNotes = () => loadList(NOTES_KEY);
  const saveNotes = (notes) => saveList(NOTES_KEY, notes);

  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }

  function saveTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* bỏ qua */ }
  }

  // Giá trị chuỗi bất kỳ (token đăng nhập, mã thiết bị…); null = xoá
  function loadValue(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function saveValue(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* bỏ qua */ }
  }

  return { loadTasks, saveTasks, loadNotes, saveNotes, loadTheme, saveTheme, loadValue, saveValue };
})();
