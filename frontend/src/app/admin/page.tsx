import OwnerUsers from '../../components/OwnerUsers'
import UtilityHeader from '../../components/auth/UtilityHeader'

export const metadata = { title: 'Учётные записи · AirCheck' }

export default function AdminPage() {
  return <div className="utility-page">
    <UtilityHeader />
    <main className="app-shell"><OwnerUsers /></main>
  </div>
}
