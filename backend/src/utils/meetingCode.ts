const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
const rand = (n: number) => Array.from({ length: n }, () => alpha[Math.floor(Math.random() * alpha.length)]).join('');
export const generateMeetingCode = () => `${rand(3)}-${rand(4)}-${rand(3)}`;
