const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function normalizeAuthApiBase(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  if (base.endsWith("/api/v1")) {
    return base;
  }
  return `${base}/api/v1`;
}

export const API_URL = normalizeAuthApiBase(rawApiUrl);

/** FastAPI returns `detail` as a string, or as a list of validation errors. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0];
      const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
      return field ? `${field}: ${first.msg}` : first.msg;
    }
  } catch {
    // non-JSON body
  }
  return fallback;
}

export const login = async (username: string, password: string) => {
  const formData = new URLSearchParams();
  formData.append("username", username);
  formData.append("password", password);

  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Login failed"));
  }

  return response.json();
};

export const register = async (
  username: string,
  password: string,
  email: string,
) => {
  const response = await fetch(`${API_URL}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password, email }),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Registration failed"));
  }

  return response.json();
};
