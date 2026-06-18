import { deployDelete } from '@/lib/deploy';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ repo: string }> },
) {
  const { repo } = await params;

  try {
    await deployDelete(repo);
    return Response.json({ status: 'deleted' });
  } catch (err) {
    return Response.json(
      { status: 'error', output: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
