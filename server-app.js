require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { pool } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test route
app.get('/', (req, res) => {
  res.send('✅ App Server يعمل!');
});

// ======================= 📝 TASKS SYSTEM API - FULL COMPATIBLE =======================

// ======================= 🔐 AUTH MIDDLEWARE =======================

// ✅ Admin Authentication - يدعم query و body
function isAdminAuthenticated(req, res, next) {
  const { user_id: queryUserId, admin_key } = req.query;
  const { admin_id: bodyAdminId } = req.body;
  const ADMIN_ID = process.env.ADMIN_ID || '7171208519';
  
  const userIdToCheck = queryUserId || bodyAdminId;
  
  if (userIdToCheck?.toString() === ADMIN_ID || admin_key === process.env.ADMIN_SECRET) {
    next();
  } else {
    res.status(403).json({ success: false, message: "Unauthorized: Admin access required" });
  }
}

// ✅ User Authentication - بسيط للتحقق من وجود المستخدم
async function validateUser(telegramId) {
  if (!telegramId || !/^\d+$/.test(telegramId.toString())) return false;
  const result = await pool.query('SELECT 1 FROM users WHERE telegram_id = $1', [telegramId]);
  return result.rows.length > 0;
}

// ======================= 📊 TASKS: AVAILABLE =======================

app.get('/api/tasks/available', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Valid user_id required" });
    }
    
    const tasks = await pool.query(`
      SELECT 
        t.id, 
        t.title, 
        t.description, 
        COALESCE(t.executor_reward, t.price, 0.01) as executor_reward,
        t.duration_seconds, 
        t.budget, 
        t.spent,
        (t.budget - t.spent) as remaining_budget,
        t.created_at,
        t.settings,
        t.target_url,
        t.settings->>'category' as category,  -- ✅ استخراج الفئة من settings
        (
          SELECT COUNT(*) 
          FROM task_executions 
          WHERE task_id = t.id AND status = 'approved'
        ) as completed_count,
        (
          SELECT COUNT(*) 
          FROM task_executions 
          WHERE task_id = t.id AND status = 'pending'
        ) as pending_count
      FROM tasks t
      WHERE t.is_active = true 
        AND t.budget > t.spent 
        AND t.creator_id != $1
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM task_executions te 
          WHERE te.task_id = t.id 
            AND te.executor_id = $1 
            AND te.status IN ('pending', 'approved')
        )
      ORDER BY t.created_at DESC
      LIMIT 50
    `, [user_id]);
    
    res.json({ success: true, data: tasks.rows });
    
  } catch (err) {
    console.error('❌ /api/tasks/available:', err);
    res.status(500).json({ success: false, message: "Failed to load tasks", error: err.message });
  }
});

// ======================= 📋 TASKS: MY TASKS =======================

app.get('/api/tasks/my', async (req, res) => {
  try {
    const userId = req.query.user_id;
    
    if (!userId || !/^\d+$/.test(userId.toString())) {
      return res.status(400).json({ success: false, message: 'Valid user_id is required' });
    }

    const query = `
      SELECT 
        t.id,
        t.title,
        t.description,
        t.budget,
        t.spent,
        COALESCE(t.executor_reward, t.price, 0.01) as executor_reward,
        t.is_active,
        t.created_at,
        t.duration_seconds,
        t.settings,
        t.target_url,
        COUNT(te.id) FILTER (WHERE te.id IS NOT NULL) AS total_executions,
        COUNT(te.id) FILTER (WHERE te.status = 'approved') AS approved_count,
        COUNT(te.id) FILTER (WHERE te.status = 'pending') AS pending_count,
        COUNT(te.id) FILTER (WHERE te.status = 'rejected') AS rejected_count,
        COUNT(te.id) FILTER (WHERE te.status = 'disputed') AS disputed_count
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te.task_id
      WHERE t.creator_id = $1 
        AND t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);

    // ✅ تحويل القيم المحتملة لـ NULL إلى 0 لضمان عمل الـ frontend
    const tasks = result.rows.map(task => ({
      ...task,
      pending_count: parseInt(task.pending_count) || 0,
      disputed_count: parseInt(task.disputed_count) || 0,
      total_executions: parseInt(task.total_executions) || 0,
      approved_count: parseInt(task.approved_count) || 0
    }));

    res.json({ success: true, data: tasks });

  } catch (err) {
    console.error('❌ /api/tasks/my:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ======================= 🔍 TASK: DETAILS =======================

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID" });
    }
    
    const task = await pool.query(`
      SELECT 
        t.*,
        (t.budget - t.spent) as remaining_budget,
        COUNT(te.id) FILTER (WHERE te.id IS NOT NULL) AS total_executions,
        COUNT(te.id) FILTER (WHERE te.status = 'approved') AS approved_count,
        COUNT(te.id) FILTER (WHERE te.status = 'pending') AS pending_count,
        COUNT(te.id) FILTER (WHERE te.status = 'disputed') AS disputed_count
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te.task_id
      WHERE t.id = $1 AND t.deleted_at IS NULL
      GROUP BY t.id
    `, [id]);
    
    if (task.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    
    const taskData = task.rows[0];
    const isCreator = taskData.creator_id?.toString() === user_id;
    
    let myExecution = null;
    if (user_id) {
      // ✅ استخدام submitted_at بدلاً من created_at
      const exec = await pool.query(
        `SELECT id, task_id, executor_id, proof, status, submitted_at, payment_amount, commission_amount
         FROM task_executions 
         WHERE task_id = $1 AND executor_id = $2 
         ORDER BY submitted_at DESC LIMIT 1`,
        [id, user_id]
      );
      if (exec.rows.length > 0) myExecution = exec.rows[0];
    }
    
    res.json({ 
      success: true, 
      task: taskData, 
      is_creator: isCreator,
      my_execution: myExecution
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id:', err);
    res.status(500).json({ success: false, message: "Failed to load task", error: err.message });
  }
});

// ======================= ➕ CREATE TASK =======================

app.post('/api/tasks/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      creator_id, title, description, reward_per_execution,
      duration_seconds, budget, target_url,
      category, verification_method, proof_requirements,
      audience, delivery_interval, execution_type, max_completion_time,
      verification_keyword, delay_hours, delay_minutes, hourly_limits, multi_interval
    } = req.body;
    
    if (!creator_id || !title || reward_per_execution === undefined || !budget) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields",
        required: ["creator_id", "title", "reward_per_execution", "budget"]
      });
    }
    
    const executorReward = parseFloat(reward_per_execution);
    const totalBudget = parseFloat(budget);
    
    if (isNaN(executorReward) || executorReward < 0.001) {
      return res.status(400).json({ success: false, message: "Invalid reward: min $0.001" });
    }
    if (isNaN(totalBudget) || totalBudget < 0.10) {
      return res.status(400).json({ success: false, message: "Invalid budget: min $0.10" });
    }
    
    const adminCommission = executorReward * 0.20;
    const totalCostPerExecution = executorReward + adminCommission;
    
    const userRes = await client.query(
      'SELECT balance FROM users WHERE telegram_id = $1', 
      [creator_id]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    const userBalance = parseFloat(userRes.rows[0].balance || 0);
    if (userBalance < totalBudget) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient balance. Need: $${totalBudget.toFixed(4)}, Have: $${userBalance.toFixed(4)}` 
      });
    }
    
    await client.query('BEGIN');
    
    try {
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', 
        [totalBudget, creator_id]
      );
      
      const settings = {
        category: category || 'other',
        verification_method: verification_method || 'manual',
        proof_requirements: proof_requirements || '',
        audience: audience || 'all',
        delivery_interval: delivery_interval || 'none',
        execution_type: execution_type || 'once',
        verification_keyword: verification_keyword || '',
        delay_hours: delay_hours || 0,
        delay_minutes: delay_minutes || 5,
        hourly_limits: hourly_limits || [],
        multi_interval: multi_interval || 0
      };
      
      const finalDuration = parseInt(duration_seconds) || parseInt(max_completion_time) || 86400;
      
      const result = await client.query(`
        INSERT INTO tasks (
          title, description, price, executor_reward, duration_seconds,
          budget, spent, creator_id, is_active, target_url, settings
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, true, $8, $9)
        RETURNING id, title, created_at, executor_reward, budget, spent, is_active, settings, target_url
      `, [
        title,
        description,
        executorReward,
        executorReward,
        finalDuration,
        totalBudget,
        creator_id,
        target_url || '',
        settings
      ]);
      
      await client.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: "Task created successfully", 
        task: result.rows[0],
        payment_info: {
          executor_reward: executorReward.toFixed(4),
          admin_commission: adminCommission.toFixed(4),
          total_cost_per_execution: totalCostPerExecution.toFixed(4),
          estimated_completions: Math.floor(totalBudget / totalCostPerExecution)
        }
      });
      
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('❌ DB Error:', dbErr);
      throw dbErr;
    }
    
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ CRITICAL /api/tasks/create:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create task", 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
});

// ======================= 🚀 APPLY FOR TASK =======================

app.post('/api/tasks/:id/apply', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    
    if (!id || !user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Invalid task ID or user ID" });
    }
    
    await client.query('BEGIN');
    
    const existing = await client.query(
      `SELECT id, status FROM task_executions 
       WHERE task_id = $1 AND executor_id = $2 AND status IN ('applied','pending','approved')`,
      [id, user_id]
    );
    
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "You already have an active execution for this task" });
    }
    
    const task = await client.query(
      `SELECT budget, spent, executor_reward, duration_seconds, is_active, deleted_at 
       FROM tasks WHERE id = $1`, 
      [id]
    );
    
    if (task.rows.length === 0 || !task.rows[0].is_active || task.rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Task not found or inactive" });
    }
    
    const executorReward = parseFloat(task.rows[0].executor_reward || task.rows[0].price || 0.01);
    const adminCommission = executorReward * 0.20;
    const totalCost = executorReward + adminCommission;
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    
    if (remaining < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Task has insufficient budget" });
    }
    
    // ✅ استخدام submitted_at بدلاً من created_at
    await client.query(
      `INSERT INTO task_executions (
         task_id, executor_id, status, payment_amount, commission_amount, submitted_at
       ) VALUES ($1, $2, 'applied', $3, $4, NOW())`,
      [id, user_id, executorReward, adminCommission]
    );
    
    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: "Applied successfully - slot reserved",
      execution: {
        reward: executorReward.toFixed(4),
        commission: adminCommission.toFixed(4),
        total_cost: totalCost.toFixed(4),
        duration_seconds: task.rows[0].duration_seconds
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/apply:', err);
    res.status(500).json({ success: false, message: "Failed to apply: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= 📤 SUBMIT PROOF =======================

app.post('/api/tasks/:id/submit-proof', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, proof, execution_id } = req.body;
    
    if (!proof || proof.trim().length < 10) {
      return res.status(400).json({ success: false, message: "Proof must be at least 10 characters" });
    }
    
    let exec;
    if (execution_id) {
      exec = await pool.query(
        `SELECT id, status, submitted_at FROM task_executions 
         WHERE id = $1 AND task_id = $2 AND executor_id = $3 AND status = 'applied'`,
        [execution_id, id, user_id]
      );
    } else {
      exec = await pool.query(
        `SELECT id, status, submitted_at FROM task_executions 
         WHERE task_id = $1 AND executor_id = $2 AND status = 'applied'`,
        [id, user_id]
      );
    }
    
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "No applied execution found for this task" });
    }
    
    await pool.query(
      `UPDATE task_executions 
       SET proof = $1, submitted_at = COALESCE(submitted_at, NOW()), status = 'pending' 
       WHERE id = $2`, 
      [proof, exec.rows[0].id]
    );
    
    res.json({ success: true, message: "Proof submitted successfully", execution_id: exec.rows[0].id });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/submit-proof:', err);
    res.status(500).json({ success: false, message: "Failed to submit proof: " + err.message });
  }
});

// ======================= 📋 TASK PROOFS =======================

app.get('/api/tasks/:id/proofs', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: "Task ID required" 
      });
    }
    
    // 🔍 التحقق من وجود المهمة
    const task = await pool.query(
      'SELECT creator_id, deleted_at FROM tasks WHERE id = $1', 
      [id]
    );

    if (task.rows.length === 0 || task.rows[0].deleted_at) {
      return res.status(404).json({ 
        success: false, 
        message: "Task not found" 
      });
    }
    
    const isCreator = task.rows[0].creator_id?.toString() === user_id;
    
    let query, params;
    
    // 👑 صاحب المهمة
    if (isCreator) {
      query = `
        SELECT 
          te.id, 
          te.proof, 
          te.status, 
          te.submitted_at,
          te.payment_amount, 
          te.commission_amount, 
          te.executor_id,
          u.username as executor_username, 
          u.telegram_id
        FROM task_executions te
        LEFT JOIN users u ON te.executor_id = u.telegram_id
        WHERE te.task_id = $1
        AND te.proof IS NOT NULL -- 🔥 يمنع ظهور applied
        ORDER BY 
          CASE 
            WHEN te.status = 'pending' THEN 1
            WHEN te.status = 'disputed' THEN 2
            WHEN te.status = 'approved' THEN 3
            WHEN te.status = 'rejected' THEN 4
            ELSE 5
          END,
          te.submitted_at DESC
      `;
      params = [id];

    // 👤 المستخدم العادي
    } else if (user_id) {
      query = `
        SELECT 
          te.id, 
          te.proof, 
          te.status, 
          te.submitted_at,
          te.payment_amount, 
          te.executor_id
        FROM task_executions te
        WHERE te.task_id = $1 
        AND te.executor_id = $2
        AND te.proof IS NOT NULL -- 🔥 يمنع ظهور applied
        ORDER BY te.submitted_at DESC
      `;
      params = [id, user_id];

    } else {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }
    
    const proofs = await pool.query(query, params);

    res.json({ 
      success: true, 
      data: proofs.rows 
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/proofs:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load proofs", 
      error: err.message 
    });
  }
});
// ======================= ✅ APPROVE PROOF =======================

app.post('/api/tasks/:id/proofs/:proofId/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: taskId, proofId } = req.params;
    const { user_id } = req.body;
    
    const task = await client.query(
      'SELECT creator_id, budget, spent FROM tasks WHERE id = $1 AND deleted_at IS NULL', 
      [taskId]
    );
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Unauthorized: You are not the task creator" });
    }
    
    const exec = await client.query(
      `SELECT id, executor_id, payment_amount, commission_amount, status 
       FROM task_executions WHERE id = $1 AND task_id = $2 AND status = 'pending'`,
      [proofId, taskId]
    );
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Execution not found or already processed" });
    }
    
    const executorId = exec.rows[0].executor_id;
    const paymentAmount = parseFloat(exec.rows[0].payment_amount);
    const adminCommission = parseFloat(exec.rows[0].commission_amount || (paymentAmount * 0.20));
    const totalCost = paymentAmount + adminCommission;
    
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
      [paymentAmount, executorId]
    );
    
    const adminId = process.env.ADMIN_ID;
    if (adminId && adminCommission > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
        [adminCommission, adminId]
      );
    }
    
    await client.query(`
      UPDATE task_executions 
      SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
      WHERE id = $2
    `, [user_id, proofId]);
    
    await client.query(
      'UPDATE tasks SET spent = spent + $1 WHERE id = $2', 
      [totalCost, taskId]
    );
    
    await client.query(`
      INSERT INTO earnings (user_id, source, amount, description, video_id, watched_seconds, created_at)
      VALUES ($1, 'task_execution', $2, $3, NULL, NULL, NOW())
    `, [executorId, paymentAmount, `Task #${taskId} execution reward (100%)`]);
    
    if (adminCommission > 0 && adminId) {
      await client.query(`
        INSERT INTO earnings (user_id, source, amount, description, video_id, watched_seconds, created_at)
        VALUES ($1, 'task_commission', $2, $3, NULL, NULL, NOW())
      `, [adminId, adminCommission, `Commission from task #${taskId} (20%)`]);
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: "Proof approved and payment sent",
      payment_details: {
        executor_received: paymentAmount.toFixed(4),
        admin_commission: adminCommission.toFixed(4),
        total_deducted: totalCost.toFixed(4)
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Approve proof:', err);
    res.status(500).json({ success: false, message: "Failed to approve: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= ❌ REJECT PROOF =======================

app.post('/api/tasks/:id/proofs/:proofId/reject', async (req, res) => {
  try {
    const { id: taskId, proofId } = req.params;
    const { user_id, reason } = req.body;
    
    const task = await pool.query('SELECT creator_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [taskId]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    
    await pool.query(`
      UPDATE task_executions 
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1
      WHERE id = $2 AND status = 'pending'
    `, [user_id, proofId]);
    
    res.json({ success: true, message: "Proof rejected", reason: reason || "Does not meet requirements" });
    
  } catch (err) {
    console.error('❌ Reject proof:', err);
    res.status(500).json({ success: false, message: "Failed to reject: " + err.message });
  }
});

// ======================= ⚠️ DISPUTES =======================

app.post('/api/tasks/:id/proofs/:proofId/dispute', async (req, res) => {
  try {
    const { id: taskId, proofId } = req.params;
    const { user_id, reason } = req.body;
    
    if (!reason || reason.trim().length < 20) {
      return res.status(400).json({ success: false, message: "Please provide a detailed reason (min 20 characters)" });
    }
    
    const exec = await pool.query(
      'SELECT id, status FROM task_executions WHERE id = $1', 
      [proofId]
    );
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Execution not found" });
    }
    
    await pool.query(`
      INSERT INTO task_disputes (execution_id, reason, status, created_at)
      VALUES ($1, $2, 'open', NOW())
    `, [proofId, reason]);
    
    await pool.query(
      'UPDATE task_executions SET status = $1 WHERE id = $2', 
      ['disputed', proofId]
    );
    
    if (typeof bot !== 'undefined' && bot?.telegram && process.env.ADMIN_ID) {
      try {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `⚠️ New Dispute:\n📋 Task: #${taskId}\n🔍 Execution: #${proofId}\n👤 User: ${user_id}\n📝 Reason:\n${reason.substring(0, 200)}...`
        );
      } catch (_) {}
    }
    
    res.json({ success: true, message: "Dispute created - Admin will review" });
    
  } catch (err) {
    console.error('❌ Create dispute:', err);
    res.status(500).json({ success: false, message: "Failed to create dispute: " + err.message });
  }
});

app.get('/api/admin/task-disputes', isAdminAuthenticated, async (req, res) => {
  try {
    const disputes = await pool.query(`
      SELECT 
        d.id, d.reason, d.status, d.created_at, d.resolved_at, d.resolution,
        te.task_id, te.executor_id, te.proof, te.payment_amount, te.status as execution_status,
        t.title as task_title, t.creator_id, t.description as task_description,
        u1.username as executor_username, u2.username as creator_username
      FROM task_disputes d
      JOIN task_executions te ON d.execution_id = te.id
      JOIN tasks t ON te.task_id = t.id
      LEFT JOIN users u1 ON te.executor_id = u1.telegram_id
      LEFT JOIN users u2 ON t.creator_id = u2.telegram_id
      WHERE d.status = 'open'
      ORDER BY d.created_at DESC
    `);
    
    res.json({ success: true, data: disputes.rows });
    
  } catch (err) {
    console.error('❌ /api/admin/task-disputes:', err);
    res.status(500).json({ success: false, message: "Failed to load disputes", error: err.message });
  }
});

app.post('/api/admin/task-disputes/:id/resolve', isAdminAuthenticated, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: disputeId } = req.params;
    const { resolution, payout_to, admin_id } = req.body;
    
    const dispute = await client.query('SELECT * FROM task_disputes WHERE id = $1', [disputeId]);
    if (dispute.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Dispute not found" });
    }
    
    const exec = await client.query(
      'SELECT * FROM task_executions WHERE id = $1', 
      [dispute.rows[0].execution_id]
    );
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Execution not found" });
    }
    
    await client.query('BEGIN');
    
    if (payout_to === 'executor') {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
        [exec.rows[0].payment_amount, exec.rows[0].executor_id]
      );
      const totalCost = exec.rows[0].payment_amount * 1.20;
      await client.query(
        'UPDATE tasks SET spent = spent + $1 WHERE id = $2', 
        [totalCost, exec.rows[0].task_id]
      );
      await client.query(
        'UPDATE task_executions SET status = $1 WHERE id = $2', 
        ['approved', exec.rows[0].id]
      );
    } else if (payout_to === 'none') {
      const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1', [exec.rows[0].task_id]);
      if (task.rows.length > 0) {
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
          [exec.rows[0].payment_amount, task.rows[0].creator_id]
        );
      }
      await client.query(
        'UPDATE task_executions SET status = $1 WHERE id = $2', 
        ['rejected', exec.rows[0].id]
      );
    }
    
    await client.query(`
      UPDATE task_disputes 
      SET status = 'resolved', resolved_at = NOW(), resolved_by = $1, resolution = $2
      WHERE id = $3
    `, [admin_id || process.env.ADMIN_ID, resolution, disputeId]);
    
    await client.query('COMMIT');
    res.json({ success: true, message: "Dispute resolved successfully" });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Resolve dispute:', err);
    res.status(500).json({ success: false, message: "Failed to resolve: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= 💰 FUND & WITHDRAW =======================

app.post('/api/tasks/:id/fund', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    await client.query('BEGIN');

    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0 || parseFloat(user.rows[0].balance || 0) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // التحقق من وجود تطبيقات قائمة
    const activeExecutions = await client.query(
      "SELECT 1 FROM task_executions WHERE task_id = $1 AND status IN ('applied','pending')",
      [id]
    );
    if (activeExecutions.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Cannot fund task: active executions exist" });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [amount, user_id]);
    
    const updatedTask = await client.query(
      "UPDATE tasks SET budget = budget + $1, is_active = true WHERE id = $2 RETURNING budget",
      [amount, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: "Funds added successfully and task reactivated", new_budget: parseFloat(updatedTask.rows[0].budget) });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/fund:', err);
    res.status(500).json({ success: false, message: "Failed to add funds: " + err.message });
  } finally {
    client.release();
  }
});

app.post('/api/tasks/:id/withdraw', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id, amount } = req.body;
    
    await client.query('BEGIN');
    
    const task = await client.query('SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    
    // ✅ التحقق من pending و disputed
    const pending = await client.query(
      'SELECT COUNT(*) FROM task_executions WHERE task_id = $1 AND status IN ($2, $3)',
      [id, 'pending', 'disputed']
    );
    if (parseInt(pending.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Cannot withdraw: pending or disputed executions exist" });
    }
    
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    const withdrawAmount = amount && amount > 0 ? parseFloat(amount) : remaining;
    
    if (withdrawAmount > remaining) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Amount exceeds remaining budget" });
    }
    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "No funds to withdraw" });
    }
    
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [withdrawAmount, user_id]);
    await client.query('UPDATE tasks SET budget = budget - $1 WHERE id = $2', [withdrawAmount, id]);
    
    if (withdrawAmount >= remaining - 0.001) {
      await client.query('UPDATE tasks SET is_active = false WHERE id = $1', [id]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: "Funds withdrawn successfully", amount: withdrawAmount });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/withdraw:', err);
    res.status(500).json({ success: false, message: "Failed to withdraw: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= 🗑️ DELETE TASK =======================

app.delete('/api/tasks/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    await client.query('BEGIN');

    // 1️⃣ التحقق من وجود المهمة وملكية المستخدم
    const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskRes.rows.length === 0 || taskRes.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    const task = taskRes.rows[0];

    // 2️⃣ التحقق من وجود تطبيقات pending أو disputed
    const pendingExec = await client.query(
  `SELECT COUNT(*) FROM task_executions
   WHERE task_id = $1 AND status IN ('pending','disputed')`,
  [id]
);

if (parseInt(pendingExec.rows[0].count) > 0) {
  await client.query('ROLLBACK');
  return res.status(400).json({
    success: false,
    message: `Cannot delete task: ${pendingExec.rows[0].count} pending/disputed execution(s)`
  });
}

    const disputedExecRes = await client.query(
      'SELECT COUNT(*) FROM task_executions te JOIN task_disputes td ON te.id = td.execution_id WHERE te.task_id = $1 AND td.status = $2',
      [id, 'open']
    );
    if (parseInt(disputedExecRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete: ${disputedExecRes.rows[0].count} disputed execution(s) without admin decision` 
      });
    }

    // 3️⃣ التحقق من وجود إثباتات pending
    const pendingProofsRes = await client.query(
      'SELECT COUNT(*) FROM task_proofs WHERE task_id = $1 AND status = $2',
      [id, 'pending']
    );
    if (parseInt(pendingProofsRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete: ${pendingProofsRes.rows[0].count} pending proof(s) exist` 
      });
    }

    // 4️⃣ استرداد الميزانية المتبقية
    const remaining = parseFloat(task.budget) - parseFloat(task.spent);
    if (remaining > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [remaining, user_id]
      );
    }

    // 5️⃣ الحذف النهائي لكل السجلات المرتبطة
    await client.query('DELETE FROM task_disputes WHERE execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [id]);
    await client.query('DELETE FROM task_proofs WHERE task_id = $1', [id]);
    await client.query('DELETE FROM task_executions WHERE task_id = $1', [id]);
    await client.query('DELETE FROM user_tasks WHERE task_id = $1', [id]);
    await client.query('DELETE FROM tasks WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true, message: "Task deleted permanently", refunded: remaining });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DELETE /api/tasks/:id:', err);
    res.status(500).json({ success: false, message: "Failed to delete: " + err.message });
  } finally {
    client.release();
  }
});

// ✅ GET /api/tasks/user-executions - جلب تنفيذات المستخدم
app.get('/api/tasks/user-executions', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Valid user_id required" });
    }
    
    // ✅ جلب التنفيذات من جدول task_executions مع تفاصيل المهمة
    const executions = await pool.query(`
      SELECT 
        te.id,
        te.task_id,
        te.executor_id,
        te.proof,
        te.status,
        te.submitted_at,
        te.payment_amount,
        t.title as task_title,
        t.description as task_description,
        t.executor_reward
      FROM task_executions te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.executor_id = $1
      ORDER BY te.submitted_at DESC
    `, [user_id]);
    
    // ✅ إضافة حقل has_dispute للتحقق من وجود نزاع
    const executionsWithDispute = await Promise.all(executions.rows.map(async (exec) => {
      const dispute = await pool.query(
        'SELECT id FROM task_disputes WHERE execution_id = $1', 
        [exec.id]
      );
      return {
        ...exec,
        has_dispute: dispute.rows.length > 0
      };
    }));
    
    res.json({ success: true, data: executionsWithDispute });
    
  } catch (err) {
    console.error('❌ /api/tasks/user-executions:', err);
    res.status(500).json({ success: false, message: "Failed to load executions", error: err.message });
  }
});
// ======================= 🔄 CRON: CLEANUP EXPIRED =======================

// ✅ تنظيف الحجوزات المنتهية تلقائياً (كل 1 دقيقة)
setInterval(async () => {
  try {
    const now = new Date();
    // ✅ استخدام submitted_at بدلاً من created_at
    const { rows } = await pool.query(`
      SELECT te.id, te.task_id, te.executor_id, t.duration_seconds, te.submitted_at
      FROM task_executions te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.status = 'pending'
        AND te.proof IS NULL
        AND te.submitted_at IS NOT NULL
        AND (te.submitted_at + COALESCE(t.duration_seconds, 86400) * INTERVAL '1 second') < $1
    `, [now]);
    
    for (const exec of rows) {
      await pool.query('DELETE FROM task_executions WHERE id = $1', [exec.id]);
      console.log(`🔄 Released expired slot: execution ${exec.id}, task ${exec.task_id}`);
    }
    
    if (rows.length > 0) {
      console.log(`✅ Cleaned ${rows.length} expired applications`);
    }
  } catch (err) {
    console.error('❌ Expired applications cleanup error:', err);
  }
}, 60 * 1000); // كل 1 دقيقة
// ======================= END TASKS SYSTEM API =======================

// === بدء التشغيل ===
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
