import { ipcMain } from 'electron'
import { userService } from '../services/UserService'

export class UserController {
  registerHandlers() {
    ipcMain.handle('get-users', () => {
      return userService.getAllUsers()
    })
    
    ipcMain.handle('add-user', (_, name: string) => {
      try {
        return userService.addUser(name)
      } catch (error: any) {
        throw new Error(error.message)
      }
    })
  }
}

export const userController = new UserController()
