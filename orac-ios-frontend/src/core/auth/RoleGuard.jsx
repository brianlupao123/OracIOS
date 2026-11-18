import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth.js";
import { canAccessRoute } from "../../accessPolicy.js";
import AccessDeniedPage from "../../pages/AccessDeniedPage.jsx";

export function RoleGuard({ path, children }) {
  const { user, checking } = useAuth();

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-orac-slate">
        Loading session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return canAccessRoute(user.role, path) ? children : <AccessDeniedPage />;
}

export default RoleGuard;
