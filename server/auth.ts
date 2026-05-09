import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'certflow-super-secret-key';
const USERS_FILE = path.resolve(process.cwd(), './data/users.json');

export interface User {
  id: string;
  username: string;
  passwordHash: string;
}

async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.writeFile(USERS_FILE, JSON.stringify([]));
  }
}

export async function getUsers(): Promise<User[]> {
  await ensureUsersFile();
  const data = await fs.readFile(USERS_FILE, 'utf-8');
  return JSON.parse(data);
}

export async function saveUsers(users: User[]) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

export interface AuthRequest extends Request {
  user?: { id: string; username: string };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET) as { id: string; username: string };
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
};

export async function register(req: Request, res: Response) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = await getUsers();
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: crypto.randomUUID(),
      username,
      passwordHash
    };

    users.push(newUser);
    await saveUsers(users);

    res.json({ success: true, message: 'User registered successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: message });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { username, password } = req.body;
    const users = await getUsers();
    const user = users.find(u => u.username === username);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ id: user.id, username: user.username });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: message });
  }
}

export function logout(req: Request, res: Response) {
  res.clearCookie('token');
  res.json({ success: true });
}

export function me(req: AuthRequest, res: Response) {
  if (req.user) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}
