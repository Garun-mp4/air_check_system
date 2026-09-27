import OwnerUsers from '../../components/OwnerUsers'

export const metadata = { title: 'Учётные записи · AirCheck' }

export default function AdminPage() {
  return <main className="app-shell"><OwnerUsers /></main>
}
