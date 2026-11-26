import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaymentStatus } from "@/components/payments/PaymentStatus";

export default async function StatusPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabase = await createClient();
  const { data: pay } = await supabase
    .from("payments")
    .select("reference,status,provider_status,invoice_url")
    .eq("reference", reference)
    .maybeSingle();
  if (!pay) notFound();

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <PaymentStatus
        reference={pay.reference}
        initialStatus={pay.status}
        initialProviderStatus={pay.provider_status}
        invoiceUrl={pay.invoice_url}
      />
    </main>
  );
}
