import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { App, BalanceRoute, ClientsRoute, ProductsRoute, ReportsRoute, SellRoute } from "./App";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <SellRoute /> },
      { path: "products", element: <ProductsRoute /> },
      { path: "clients", element: <ClientsRoute /> },
      { path: "balance", element: <BalanceRoute /> },
      { path: "reports", element: <ReportsRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
