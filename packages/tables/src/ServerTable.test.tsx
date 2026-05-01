import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/items",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import type { ColumnDef } from "@tanstack/react-table";
import { ServerTable } from "./ServerTable.js";
import type { TablePaginationMeta } from "./types.js";

interface Row {
  id: string;
  name: string;
  status: "active" | "archived";
}

const rows: Row[] = [
  { id: "1", name: "alpha", status: "active" },
  { id: "2", name: "beta", status: "archived" },
];

const columns: ColumnDef<Row>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "status", accessorKey: "status", header: "Status" },
];

const meta: TablePaginationMeta = {
  page: 1,
  pageSize: 25,
  totalCount: 2,
  totalPages: 1,
  hasNext: false,
};

beforeEach(() => {
  pushMock.mockClear();
  currentSearch = "";
});

afterEach(() => {
  currentSearch = "";
});

describe("ServerTable — rendering", () => {
  it("renders rows from the supplied data", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("renders header cells from columnDef.header", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
  });

  it("shows the empty state when data is []", () => {
    render(
      <ServerTable
        columns={columns}
        data={[]}
        pagination={{ ...meta, totalCount: 0 }}
        emptyState={<span>nothing here</span>}
      />,
    );
    expect(screen.getByText("nothing here")).toBeTruthy();
  });

  it("falls back to a default empty message", () => {
    render(
      <ServerTable
        columns={columns}
        data={[]}
        pagination={{ ...meta, totalCount: 0 }}
      />,
    );
    expect(screen.getByText("No results.")).toBeTruthy();
  });

  it("forwards className to the wrapper div", () => {
    const { container } = render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        className="border rounded"
      />,
    );
    expect(container.querySelector("div[data-plinth-table]")?.className).toBe(
      "border rounded",
    );
  });
});

describe("ServerTable — sorting", () => {
  it("clicking a sortable header pushes ?sortBy=...&sortOrder=asc", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    fireEvent.click(screen.getByText("Name"));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("sortBy=name");
    expect(url).toContain("sortOrder=asc");
  });

  it("clicking the active sort column flips to desc", () => {
    currentSearch = "sortBy=name&sortOrder=asc";
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    fireEvent.click(screen.getByText("Name"));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("sortOrder=desc");
  });

  it("renders aria-sort='ascending' for the active asc column", () => {
    currentSearch = "sortBy=name&sortOrder=asc";
    const { container } = render(
      <ServerTable columns={columns} data={rows} pagination={meta} />,
    );
    const headers = container.querySelectorAll("thead th");
    expect(headers[0].getAttribute("aria-sort")).toBe("ascending");
    expect(headers[1].getAttribute("aria-sort")).toBe("none");
  });

  it("does not push when enableSorting=false", () => {
    const cols: ColumnDef<Row>[] = [
      { id: "name", accessorKey: "name", header: "Name", enableSorting: false },
    ];
    render(<ServerTable columns={cols} data={rows} pagination={meta} />);
    fireEvent.click(screen.getByText("Name"));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("ServerTable — row click", () => {
  it("invokes onRowClick with the original row data", () => {
    const onRowClick = vi.fn();
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("alpha"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});

describe("ServerTable — pager", () => {
  it("disables prev on page 1", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    const prev = screen.getByLabelText("Previous page") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("disables next when hasNext is false and totalPages reached", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    const next = screen.getByLabelText("Next page") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("clicks next when hasNext is true", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={{ ...meta, hasNext: true, totalPages: undefined }}
      />,
    );
    const next = screen.getByLabelText("Next page") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("page=2");
  });

  it("renders a 1–N of total summary in offset mode", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={{
          page: 2,
          pageSize: 10,
          totalCount: 25,
          totalPages: 3,
          hasNext: true,
        }}
      />,
    );
    expect(screen.getByText("11–20 of 25")).toBeTruthy();
  });
});

describe("ServerTable — filters (default header)", () => {
  it("renders a search input with the placeholder", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        searchPlaceholder="Search items..."
      />,
    );
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    expect(input.placeholder).toBe("Search items...");
  });

  it("typing in the search input pushes ?q=...", () => {
    render(<ServerTable columns={columns} data={rows} pagination={meta} />);
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alpha" } });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("q=alpha");
  });

  it("changing a select filter pushes the chosen value", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        filters={[
          {
            type: "select",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ],
          },
        ]}
      />,
    );
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "active" } });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("status=active");
  });

  it("toggling a boolean filter pushes ?key=true and clears it on uncheck", () => {
    currentSearch = "";
    const { rerender } = render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        filters={[{ type: "boolean", key: "starred", label: "Starred" }]}
      />,
    );
    const cb = screen.getByLabelText("Starred") as HTMLInputElement;
    fireEvent.click(cb);
    let url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("starred=true");

    pushMock.mockClear();
    currentSearch = "starred=true";
    rerender(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        filters={[{ type: "boolean", key: "starred", label: "Starred" }]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Starred"));
    url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("starred=");
  });

  it("a date-range filter writes <key>_from / <key>_to", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        filters={[{ type: "date-range", key: "created", label: "Created" }]}
      />,
    );
    const from = screen.getByLabelText("Created from") as HTMLInputElement;
    fireEvent.change(from, { target: { value: "2026-01-01" } });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("created_from=2026-01-01");
  });
});

describe("ServerTable — render slots", () => {
  it("renderHeader replaces the default header", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        renderHeader={() => <div>custom header</div>}
      />,
    );
    expect(screen.getByText("custom header")).toBeTruthy();
    expect(screen.queryByLabelText("Search")).toBeNull();
  });

  it("renderRow replaces the default <tr>", () => {
    render(
      <ServerTable
        columns={columns}
        data={rows}
        pagination={meta}
        renderRow={(row) => (
          <tr key={row.id}>
            <td colSpan={2}>custom-{row.name}</td>
          </tr>
        )}
      />,
    );
    expect(screen.getByText("custom-alpha")).toBeTruthy();
    expect(screen.getByText("custom-beta")).toBeTruthy();
  });
});
