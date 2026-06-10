import { useState } from 'react'

export function useCVController() {
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])

  const fetchCandidates = async () => {
    // Stub
  }

  return {
    searchTerm,
    setSearchTerm,
    activeTags,
    setActiveTags,
    fetchCandidates
  }
}
