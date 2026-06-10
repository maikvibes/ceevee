import { useState, useEffect, useCallback } from 'react'

export interface User {
  id: number
  name: string
}

export function useUserController() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.getUsers()
      setUsers(data)
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const addUser = async (name: string) => {
    if (!name.trim()) return false
    try {
      await window.api.addUser(name)
      await loadUsers()
      return true
    } catch (error) {
      console.error('Failed to add user:', error)
      return false
    }
  }

  return {
    users,
    loading,
    addUser,
    refreshUsers: loadUsers
  }
}
