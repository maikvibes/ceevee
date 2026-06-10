import db from '../db'

export interface User {
  id: number
  name: string
}

export class UserRepository {
  getAllUsers(): User[] {
    return db.prepare('SELECT * FROM users').all() as User[]
  }

  addUser(name: string): number | bigint {
    const info = db.prepare('INSERT INTO users (name) VALUES (?)').run(name)
    return info.lastInsertRowid
  }
}

export const userRepository = new UserRepository()
