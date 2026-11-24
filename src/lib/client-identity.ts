/** A predictable document ID is never proof of tenant or phone ownership. */
export function matchesClientIdentity(client: Record<string, unknown> | undefined, businessId: string, phone: string): boolean {
  return client?.businessId === businessId && typeof client.phone === 'string' && client.phone.replace(/\D/g, '') === phone;
}
