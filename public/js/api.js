// Gọi API server kèm token đăng nhập; lưu/xoá phiên đăng nhập trong trình duyệt.
const Api = (() => {
  const TOKEN_KEY = "todo.token";
  const EMAIL_KEY = "todo.email";
  let onUnauthorized = () => {};

  // Có server khi app được mở qua http(s); mở thẳng file thì app chạy cục bộ, không đăng nhập
  const available = () => location.protocol.startsWith("http");
  const token = () => Storage.loadValue(TOKEN_KEY);

  function setSession(session) {
    Storage.saveValue(TOKEN_KEY, session ? session.token : null);
    Storage.saveValue(EMAIL_KEY, session ? session.email : null);
  }

  function errorMessage(data, status) {
    if (data && typeof data.detail === "string") return data.detail;
    if (status === 422) return "Dữ liệu không hợp lệ";
    return `Lỗi server (${status})`;
  }

  /** Gọi API. Lỗi HTTP ném Error có `.status`; mất mạng ném Error không có `.status`. */
  async function request(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* không có nội dung JSON */ }
    if (res.status === 401 && t) {
      setSession(null);
      onUnauthorized();
    }
    if (!res.ok) throw Object.assign(new Error(errorMessage(data, res.status)), { status: res.status });
    return data;
  }

  async function login(email, password, register = false) {
    const session = await request("POST", register ? "/api/auth/register" : "/api/auth/login", { email, password });
    setSession(session);
    return session;
  }

  async function logout() {
    try { await request("POST", "/api/auth/logout"); } catch { /* mất mạng vẫn đăng xuất trên máy */ }
    setSession(null);
  }

  return {
    available,
    request,
    login,
    logout,
    isLoggedIn: () => !!token(),
    email: () => Storage.loadValue(EMAIL_KEY),
    onUnauthorized: (fn) => { onUnauthorized = fn; },
  };
})();
