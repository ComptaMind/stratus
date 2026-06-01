import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SidebarNav } from "./_components/SidebarNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <SidebarNav email={email} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
