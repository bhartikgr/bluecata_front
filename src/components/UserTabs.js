"use client";
import * as React from "react";

export function Tabs({ children, defaultValue }) {
  const [active, setActive] = React.useState(defaultValue);

  // Clone only direct children and inject active + setActive
  return (
    <div className="w-full">
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, { active, setActive });
        }
        return child;
      })}
    </div>
  );
}

export function TabsList({ children, active, setActive }) {
  return (
    <div className="flex border-b bg-gray-50 rounded-t-lg shadow-sm">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child, { active, setActive })
          : child
      )}
    </div>
  );
}

export function TabsTrigger({ value, children, active, setActive }) {
  const isActive = active === value;
  return (
    <button
      onClick={() => setActive(value)}
      className={`px-4 py-2 transition-all duration-200 
        ${
          isActive
            ? "border-b-2 border-blue-500 font-semibold text-blue-600"
            : "text-gray-500 hover:text-blue-500"
        }`}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, active }) {
  if (active !== value) return null;
  return (
    <div className="p-4 border border-gray-200 rounded-b-lg shadow-sm bg-white">
      {children}
    </div>
  );
}
