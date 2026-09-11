import { Shell } from "@/components/shell";
import { editionFor } from "@/lib/edition";

/**
 * A server component, so the masthead date is decided once per request rather
 * than re-derived during hydration.
 */
export default function Page() {
  return <Shell edition={editionFor(new Date())} />;
}
