'use strict';

// Idempotent synthetic customer demo scenarios. Safe to run on every local startup.
module.exports = function ensureCustomerDemoOrders({ get, all, run, nowIso }) {
  const customer = get("SELECT u.id AS user_id, u.customer_id, c.name AS customer_name FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.email=? AND u.is_active=1", "customer@disruptioniq.local");
  if (!customer?.customer_id) return { created: 0, reason: "Demo customer account is not provisioned." };

  const warehouses = all("SELECT * FROM warehouses ORDER BY id");
  const suppliers = all("SELECT * FROM suppliers WHERE is_active=1 ORDER BY id");
  const catalogItem = get("SELECT sku,item_name,unit_price FROM order_items ORDER BY id LIMIT 1") || { sku: "SKU-MCU-01", item_name: "Cortex-M4 Industrial Microcontroller", unit_price: 28.5 };
  if (!warehouses.length || !suppliers.length) return { created: 0, reason: "Base warehouse or supplier data is not seeded yet." };

  const scenarios = [
    {
      order: "ORD-DEMO-CUSTOMER-002", tracking: "DIQ-DEMO-PORT-002", disruption: "DIS-DEMO-PORT-002",
      title: "Port congestion at transshipment terminal", type: "Port Congestion", severity: "High",
      origin: "Singapore", destination: "Rotterdam", delay: 30, risk: 82, progress: 38,
      description: "Synthetic demo scenario: port-terminal congestion has increased vessel waiting time and caused a missed transshipment connection. The shipment is delayed pending a revised connection window.",
      route: "Singapore → Rotterdam", impact: "Missed transshipment connection; estimated 30-hour delay",
      qty: 80, value: 18400, priority: "High",
      suggestions: [
        ["RP-DEMO-PORT-EXPEDITE-002", "Reserve expedited alternate vessel connection", "Expedited Freight", 1450, 22, "Use the next available priority vessel connection to bypass the congested sailing window."],
        ["RP-DEMO-PORT-ROUTE-002", "Reroute through an alternate regional gateway", "Route Diversion", 2100, 28, "Divert through an alternate gateway with available handling capacity."]
      ]
    },
    {
      order: "ORD-DEMO-CUSTOMER-003", tracking: "DIQ-DEMO-WEATHER-003", disruption: "DIS-DEMO-WEATHER-003",
      title: "Severe weather disruption along the delivery corridor", type: "Severe Weather", severity: "Critical",
      origin: "Chennai", destination: "Singapore", delay: 42, risk: 94, progress: 24,
      description: "Synthetic demo scenario: severe weather has restricted the planned transport corridor and delayed departure clearance. The shipment is held for a safe revised routing window.",
      route: "Chennai → Singapore", impact: "Weather-related route restriction; estimated 42-hour delay",
      qty: 55, value: 26750, priority: "Critical",
      suggestions: [
        ["RP-DEMO-WEATHER-ALT-003", "Select a weather-cleared alternate route", "Alternate Route", 1850, 30, "Use a verified alternate corridor after the weather restriction clears."],
        ["RP-DEMO-WEATHER-SPLIT-003", "Prioritise a partial shipment for urgent items", "Priority Partial Dispatch", 2650, 36, "Allocate priority transport capacity to the most time-sensitive units."]
      ]
    }
  ];

  let created = 0;
  const now = nowIso();
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    let order = get("SELECT * FROM customer_orders WHERE order_number=?", s.order);
    if (!order) {
      const warehouse = warehouses[i % warehouses.length];
      const deadline = new Date(Date.now() + (i === 0 ? 36 : 48) * 3600000).toISOString();
      const result = run("INSERT INTO customer_orders(order_number,customer_id,customer_name,customer_tier,status,priority,total_value,assigned_warehouse_id,order_date,delivery_deadline) VALUES(?,?,?,'Gold','Delayed',?,?,?,?,?)",
        s.order, customer.customer_id, customer.customer_name, s.priority, s.value, warehouse.id, now, deadline);
      order = get("SELECT * FROM customer_orders WHERE id=?", Number(result.lastInsertRowid));
      run("INSERT INTO order_items(order_id,sku,item_name,quantity,unit_price) VALUES(?,?,?,?,?)", order.id, catalogItem.sku, catalogItem.item_name, s.qty, Number(catalogItem.unit_price || 28.5));
      created++;
    } else {
      run("UPDATE customer_orders SET customer_id=?,status='Delayed',priority=? WHERE id=?", customer.customer_id, s.priority, order.id);
    }

    let shipment = get("SELECT * FROM shipments WHERE tracking_number=?", s.tracking);
    if (!shipment) {
      const originWarehouse = warehouses[(i + 1) % warehouses.length];
      const destinationWarehouse = warehouses[i % warehouses.length];
      const supplier = suppliers[i % suppliers.length];
      const eta = new Date(Date.now() + s.delay * 3600000).toISOString();
      const result = run("INSERT INTO shipments(tracking_number,supplier_id,origin_warehouse_id,destination_warehouse_id,carrier,transport_mode,status,origin_city,destination_city,estimated_departure,actual_departure,estimated_arrival,actual_arrival,created_at,ui_status,risk_score,progress,unit_count,eta_label) VALUES(?,?,?,?,?,'Road','Delayed',?,?,?,?,?,NULL,?,'Delayed',?,?,?,?)",
        s.tracking, supplier.id, originWarehouse.id, destinationWarehouse.id, "Demo Logistics Carrier", s.origin, s.destination,
        new Date(Date.now() - 8 * 3600000).toISOString(), new Date(Date.now() - 7 * 3600000).toISOString(), eta, now, s.risk, s.progress, s.qty, "Delayed by approximately " + s.delay + " hours");
      shipment = get("SELECT * FROM shipments WHERE id=?", Number(result.lastInsertRowid));
      run("INSERT INTO shipment_items(shipment_id,sku,item_name,quantity) VALUES(?,?,?,?)", shipment.id, catalogItem.sku, catalogItem.item_name, s.qty);
    } else {
      run("UPDATE shipments SET status='Delayed',ui_status='Delayed',risk_score=?,progress=? WHERE id=?", s.risk, s.progress, shipment.id);
    }

    let disruption = get("SELECT * FROM disruptions WHERE disruption_code=?", s.disruption);
    if (!disruption) {
      const result = run("INSERT INTO disruptions(disruption_code,title,disruption_type,severity,status,shortage_category,shipment_id,warehouse_id,location,description,estimated_delay_hours,detected_at,ui_route,ui_impact,ui_age,ui_owner) VALUES(?,?,?,?, 'Active','Operational Delay',?,?,?,?,?,?,?,?,'New','Hub In-Charge')",
        s.disruption, s.title, s.type, s.severity, shipment.id, shipment.destination_warehouse_id, s.destination, s.description, s.delay, now, s.route, s.impact);
      disruption = get("SELECT * FROM disruptions WHERE id=?", Number(result.lastInsertRowid));
    }
    run("INSERT OR IGNORE INTO disruption_affected_orders(disruption_id,customer_order_id) VALUES(?,?)", disruption.id, order.id);

    for (const suggestion of s.suggestions) {
      let plan = get("SELECT * FROM recovery_plans WHERE plan_code=?", suggestion[0]);
      if (!plan) {
        const result = run("INSERT INTO recovery_plans(plan_code,disruption_id,customer_order_id,title,strategy_type,status,sku,quantity,source_warehouse_id,destination_warehouse_id,source_location,destination_location,estimated_cost,estimated_delay_reduction_hours,description,rationale,version,created_by_id,created_at,updated_at,protected_value,priority,progress,due_label) VALUES(?,?,?,?,?,'Draft',?,?,?,?,?,?,?,?,?,?,1,NULL,?,?,?,?,0,?)",
          suggestion[0], disruption.id, order.id, suggestion[1], suggestion[2], catalogItem.sku, s.qty,
          warehouses[(i + 1) % warehouses.length].id, warehouses[i % warehouses.length].id,
          s.origin, s.destination, suggestion[3], suggestion[4],
          "Suggested demo recovery option for " + s.disruption + ". Selection and execution require Recovery Manager action.",
          suggestion[5], now, now, s.value, s.priority, "Awaiting Recovery Manager selection");
        plan = get("SELECT * FROM recovery_plans WHERE id=?", Number(result.lastInsertRowid));
        run("INSERT INTO recovery_actions(recovery_plan_id,action_sequence,action_type,description,status,cost,assigned_to_role) VALUES(?,1,'SIMULATED_RESOURCE_ALLOCATION',?,'Pending',?,'HUB_INCHARGE')",
          plan.id, suggestion[5], suggestion[3]);
      }
    }

    const noticeTitle = "Delay update — " + s.order;
    if (!get("SELECT id FROM notifications WHERE recipient_user_id=? AND customer_order_id=? AND title=? LIMIT 1", customer.user_id, order.id, noticeTitle)) {
      run("INSERT INTO notifications(recipient_role,recipient_user_id,title,message,category,is_read,created_at,customer_order_id,disruption_id,data_origin) VALUES('CUSTOMER',?,?,?,'Disruption',0,?,?,?,'synthetic')",
        customer.user_id, noticeTitle, s.description + " Current status: Delayed. Risk score: " + s.risk + "/100. Recovery options are being reviewed by the operations team.", now, order.id, disruption.id);
    }

    for (const role of ["HUB_INCHARGE", "RISK_ANALYST", "RECOVERY_MANAGER"]) {
      const recipient = get("SELECT id FROM users WHERE role=? AND is_active=1 ORDER BY id LIMIT 1", role);
      const title = role.replace("_", " ") + " — " + s.disruption;
      if (recipient && !get("SELECT id FROM notifications WHERE recipient_user_id=? AND disruption_id=? AND title=? LIMIT 1", recipient.id, disruption.id, title)) {
        run("INSERT INTO notifications(recipient_role,recipient_user_id,title,message,category,is_read,created_at,disruption_id,data_origin) VALUES(?,?,?,?,'Disruption',0,?,?,'synthetic')",
          role, recipient.id, title, s.title + ". " + s.description + " Risk score: " + s.risk + "/100. Review the disruption and recovery suggestions.", now, disruption.id);
      }
    }
  }
  return { created, totalDemoOrders: 3 };
};
