import { NavLink } from 'react-router-dom'
import { House, Library, Search, Settings } from 'lucide-react'

const items = [
  { to: '/', label: 'Home', icon: House },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `nav-item${isActive ? ' active is-active' : ''}`
            }
          >
            <Icon className="nav-icon" size={22} strokeWidth={2} aria-hidden="true" />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
