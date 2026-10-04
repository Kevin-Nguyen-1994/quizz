import CreatorNavBar from './CreatorNavBar';

export default function AdminNav() {
  return (
    <CreatorNavBar
      basePath="/admin"
      loginPath="/login"
      showUsers
      showAssignments
      playLabel="Player View ↗"
    />
  );
}
