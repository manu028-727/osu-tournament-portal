export function roleConfiguration(role: {
  name: string;
  description: string;
  permissions: { permissionKey: string }[];
}) {
  return JSON.stringify({
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((p) => p.permissionKey).sort(),
  });
}
