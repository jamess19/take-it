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

  return { loadTasks, saveTasks, loadTheme, saveTheme };
})();
