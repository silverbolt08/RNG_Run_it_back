import { TrackerScreen } from '@/components/features/tracker/tracker-screen';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrackerScreen orderId={id} />;
}
