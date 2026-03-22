// worker/src/utils/validate.js

export function validate(body, rules) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const val = body?.[field];
    const missing = val === undefined || val === null || val === '';
    if (rule.required && missing) { errors.push(`${field} is required`); continue; }
    if (missing) continue;
    if (rule.type === 'string' && typeof val !== 'string') errors.push(`${field} must be a string`);
    if (rule.type === 'number' && typeof val !== 'number') errors.push(`${field} must be a number`);
    if (rule.type === 'boolean' && typeof val !== 'boolean') errors.push(`${field} must be a boolean`);
    if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) errors.push(`${field} must be at least ${rule.minLength} characters`);
    if (rule.maxLength && typeof val === 'string' && val.length > rule.maxLength) errors.push(`${field} must be at most ${rule.maxLength} characters`);
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) errors.push(`${field} must be a valid email`);
    if (rule.enum && !rule.enum.includes(val)) errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
    if (rule.pattern && !rule.pattern.test(val)) errors.push(`${field} has an invalid format`);
  }
  return { valid: errors.length === 0, errors };
}

export const pick    = (obj, keys) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
export const compact = (obj)       => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
