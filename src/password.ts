export const PASSWORD_POLICY =
  "至少 12 个字符，包含大写英文字母、小写英文字母和数字。";
export function passwordRules(password: string) {
  return [
    {
      id: "length",
      label: "至少 12 个字符",
      met: Array.from(password).length >= 12,
    },
    { id: "upper", label: "包含大写英文字母 A–Z", met: /[A-Z]/.test(password) },
    { id: "lower", label: "包含小写英文字母 a–z", met: /[a-z]/.test(password) },
    { id: "digit", label: "包含数字 0–9", met: /[0-9]/.test(password) },
  ];
}
export const passwordValid = (password: string) =>
  passwordRules(password).every((rule) => rule.met);
/** Only fixed or bounded policy text is returned; never echo the password/error. */
export function passwordError(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const data = error as {
    code?: unknown;
    message?: unknown;
    reasons?: unknown;
  };
  const text = typeof data.message === "string" ? data.message : "";
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  if (
    reasons.includes("pwned") ||
    /password.*(?:breach|leaked|pwned|compromised)/i.test(text)
  )
    return "此密码出现在已泄露密码库中，请换一个未使用过的密码。";
  const minimum =
    /(?:at least|minimum(?: length)?(?: of)?)\s+(\d{1,3})\s*(?:characters|chars)/i.exec(
      text,
    );
  if (minimum)
    return `服务器要求密码至少 ${Number(minimum[1])} 个字符，请增加长度。`;
  if (
    reasons.includes("length") ||
    /password.*(?:too short|not long enough)/i.test(text)
  )
    return `密码长度不足。${PASSWORD_POLICY}服务器可能要求更长的密码。`;
  if (
    reasons.includes("characters") ||
    /password.*(?:must contain|should contain|uppercase|lowercase)/i.test(text)
  )
    return "密码不符合服务器的字符组合要求。请使用大小写英文字母和数字，并检查服务器是否另要求特殊字符。";
  if (
    data.code === "weak_password" ||
    /weak password|password.*(?:requirements|too weak)/i.test(text)
  )
    return `密码不符合服务器安全规则。${PASSWORD_POLICY}请确认是否还有额外的服务器要求。`;
  if (data.code === "same_password")
    return "新密码不能与当前密码相同，请换一个新密码。";
  return null;
}
