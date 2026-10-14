export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
