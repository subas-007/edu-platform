import { importSPKI, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { ROLE_HOME, type UserRole } from '@/lib/roles';

/**
 * Edge gate for dashboard route groups. This is a UX/defence-in-depth layer:
 * the API independently enforces RBAC on every request, so a bypass here
 * yields an empty shell, never data.
 */
const ROUTE_ROLE: Array<[prefix: string, role: UserRole]> = [
  ['/admin', 'ADMIN'],
  ['/examiner', 'EXAMINER'],
  ['/student', 'STUDENT'],
];

let publicKeyPromise: ReturnType<typeof importSPKI> | null = null;
function getPublicKey() {
  const b64 = process.env.JWT_PUBLIC_KEY_B64;
  if (!b64) throw new Error('JWT_PUBLIC_KEY_B64 is not configured');
  publicKeyPromise ??= importSPKI(atob(b64), 'ES256');
  return publicKeyPromise;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requiredRole = ROUTE_ROLE.find(([prefix]) => pathname.startsWith(prefix))?.[1];
  if (!requiredRole) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname + search);

  const token = request.cookies.get('access_token')?.value;
  if (!token) return NextResponse.redirect(loginUrl);

  try {
    const { payload } = await jwtVerify(token, await getPublicKey(), {
      algorithms: ['ES256'],
      issuer: 'edu-platform-api',
      audience: 'edu-platform',
    });
    const role = payload.role as UserRole;
    if (role !== requiredRole) {
      return NextResponse.redirect(new URL(ROLE_HOME[role] ?? '/login', request.url));
    }
    return NextResponse.next();
  } catch {
    // Expired/invalid — the login page attempts a silent refresh first.
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/admin/:path*', '/examiner/:path*', '/student/:path*'],
};
