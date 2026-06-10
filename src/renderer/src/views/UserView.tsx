import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUserController } from '../controllers/useUserController'

export function UserView() {
  const { users, addUser, loading } = useUserController()
  const [name, setName] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await addUser(name)) {
      setName('')
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter a name..."
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !name.trim()}>
          Add User
        </Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-border pb-2 text-foreground">
          Users in Database {loading && <span className="text-muted-foreground text-sm">(Loading...)</span>}
        </h2>
        {users.length === 0 && !loading ? (
          <p className="text-muted-foreground text-sm text-center py-4">No users found.</p>
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.id} className="flex items-center justify-between bg-muted/50 px-4 py-2 rounded-md border border-border">
                <span className="font-medium text-foreground">{user.name}</span>
                <span className="text-xs text-muted-foreground">ID: {user.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
