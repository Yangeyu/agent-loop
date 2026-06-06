export async function fetchArtifactContent(input: {
  apiBaseUrl: string
  path: string
}) {
  const response = await fetch(`${input.apiBaseUrl}/api/files/content?path=${encodeURIComponent(input.path)}`)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<{
    path: string
    filename: string
    content: string
  }>
}
