import { userRepository, User } from '../repositories/UserRepository'

export class UserService {
  getAllUsers(): User[] {
    return userRepository.getAllUsers()
  }

  addUser(name: string): number | bigint {
    // You can add business logic here, e.g., validation
    if (!name || name.trim() === '') {
      throw new Error('Name cannot be empty')
    }
    return userRepository.addUser(name)
  }
}

export const userService = new UserService()
