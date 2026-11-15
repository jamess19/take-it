// Lưu/đọc danh sách công việc và cài đặt trong localStorage của trình duyệt.
const Storage = (() => {
  const TASKS_KEY = "todo.tasks.v1";
  const THEME_KEY = "todo.theme";

  function loadTasks() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveTasks(tasks) {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error("Không lưu được dữ liệu:", err);
    }
  }

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

  return { loadTasks, saveTasks, loadTheme, saveTheme, loadValue, saveValue };
})();
