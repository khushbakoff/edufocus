const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'edufocus_secret_key_2024';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// IN-MEMORY DATABASE (MVP)
// ============================================
const db = {
  teachers: [],      // { id, name, surname, email, phone, school, subject, password }
  sessions: [],      // { id, teacherId, name, subject, qrCode, status, createdAt, students[], duration }
};

// ============================================
// AUTH ROUTES
// ============================================

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, surname, email, phone, school, subject, password } = req.body;

    // Check if email already exists
    const existing = db.teachers.find(t => t.email === email);
    if (existing) {
      return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const teacher = {
      id: uuidv4(),
      name,
      surname,
      email,
      phone,
      school,
      subject,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    db.teachers.push(teacher);

    const token = jwt.sign({ id: teacher.id, email: teacher.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      teacher: { id: teacher.id, name: teacher.name, surname: teacher.surname, email: teacher.email, school: teacher.school, subject: teacher.subject }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const teacher = db.teachers.find(t => t.email === email);
    if (!teacher) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    const isValid = await bcrypt.compare(password, teacher.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    const token = jwt.sign({ id: teacher.id, email: teacher.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      teacher: { id: teacher.id, name: teacher.name, surname: teacher.surname, email: teacher.email, school: teacher.school, subject: teacher.subject }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token topilmadi' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.teacherId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
}

// Get teacher profile
app.get('/api/profile', authMiddleware, (req, res) => {
  const teacher = db.teachers.find(t => t.id === req.teacherId);
  if (!teacher) return res.status(404).json({ error: 'O\'qituvchi topilmadi' });

  res.json({
    id: teacher.id,
    name: teacher.name,
    surname: teacher.surname,
    email: teacher.email,
    phone: teacher.phone,
    school: teacher.school,
    subject: teacher.subject
  });
});

// ============================================
// SESSION ROUTES
// ============================================

// Create session
app.post('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const { name, subject, duration } = req.body;
    const sessionId = uuidv4().substring(0, 8);

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;
    const sessionUrl = `${baseUrl}/student.html?session=${sessionId}`;

    // Generate QR code
    const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#FFFFFF',
        light: '#0F172A'
      }
    });

    const session = {
      id: sessionId,
      teacherId: req.teacherId,
      name: name || 'Yangi dars',
      subject: subject || '',
      qrCode: qrDataUrl,
      qrUrl: sessionUrl,
      status: 'active',      // active, paused, ended
      locked: true,           // true = students locked, false = students free
      createdAt: new Date().toISOString(),
      duration: duration || 45,
      students: [],           // { id, name, device, joinedAt, isActive, socketId }
      activeQuiz: null,
      quizSubmissions: [],
      activeMaterial: null
    };

    db.sessions.push(session);

    res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sessiya yaratishda xatolik' });
  }
});

// Get active sessions for teacher
app.get('/api/sessions', authMiddleware, (req, res) => {
  const sessions = db.sessions
    .filter(s => s.teacherId === req.teacherId)
    .map(s => ({
      ...s,
      studentCount: s.students.length,
      activeStudents: s.students.filter(st => st.isActive).length
    }));

  res.json(sessions);
});

// Get single session
app.get('/api/sessions/:id', (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  res.json({
    id: session.id,
    name: session.name,
    subject: session.subject,
    status: session.status,
    locked: session.locked,
    duration: session.duration,
    createdAt: session.createdAt,
    studentCount: session.students.length
  });
});

// Regenerate QR code
app.post('/api/sessions/:id/regenerate-qr', authMiddleware, async (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const sessionUrl = `${baseUrl}/student.html?session=${session.id}&t=${Date.now()}`;

  const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
    width: 400,
    margin: 2,
    color: {
      dark: '#FFFFFF',
      light: '#0F172A'
    }
  });

  session.qrCode = qrDataUrl;
  session.qrUrl = sessionUrl;

  res.json({ success: true, qrCode: qrDataUrl });
});

// Helper to calculate session statistics
function calculateSessionStats(session) {
  const startTime = new Date(session.createdAt).getTime();
  const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const actualDurationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

  const totalStudents = session.students ? session.students.length : 0;
  const totalViolations = session.students
    ? session.students.reduce((sum, st) => sum + (st.violationsCount || 0), 0)
    : 0;

  // Calculate focus score per student (100 base, -15 per violation, minimum 0)
  const studentsWithScores = (session.students || []).map(st => {
    const violations = st.violationsCount || 0;
    const score = Math.max(0, 100 - (violations * 15));
    let rating = "A'lo";
    let badgeClass = 'badge-green';

    if (violations === 0) {
      rating = "A'lo";
      badgeClass = 'badge-green';
    } else if (violations <= 2) {
      rating = 'Yaxshi';
      badgeClass = 'badge-yellow';
    } else {
      rating = 'Diqqatsiz';
      badgeClass = 'badge-red';
    }

    const quizSubmission = (session.quizSubmissions || []).find(q => q.studentId === st.id);

    return {
      id: st.id,
      name: st.name,
      device: st.device,
      joinedAt: st.joinedAt,
      violationsCount: violations,
      focusScore: score,
      rating,
      badgeClass,
      quizScore: quizSubmission ? `${quizSubmission.correctCount}/${quizSubmission.totalQuestions} (${quizSubmission.percentage}%)` : (st.quizScore || '—')
    };
  });

  // Average focus score for the class
  const avgFocus = totalStudents > 0
    ? Math.round(studentsWithScores.reduce((sum, st) => sum + st.focusScore, 0) / totalStudents)
    : 100;

  const perfectStudents = studentsWithScores.filter(st => st.violationsCount === 0);
  const flaggedStudents = studentsWithScores.filter(st => st.violationsCount > 0);

  // Quiz summary if any
  const quizSummary = session.activeQuiz ? {
    title: session.activeQuiz.title,
    totalQuestions: session.activeQuiz.questions.length,
    submissionsCount: (session.quizSubmissions || []).length,
    averageScore: (session.quizSubmissions && session.quizSubmissions.length > 0)
      ? Math.round(session.quizSubmissions.reduce((sum, sub) => sum + sub.percentage, 0) / session.quizSubmissions.length)
      : 0
  } : null;

  return {
    sessionId: session.id,
    sessionName: session.name,
    subject: session.subject || 'Umumiy',
    createdAt: session.createdAt,
    endedAt: session.endedAt || new Date().toISOString(),
    plannedDuration: session.duration || 45,
    actualDuration: actualDurationMinutes,
    totalStudents,
    totalViolations,
    averageFocusScore: avgFocus,
    perfectStudentsCount: perfectStudents.length,
    flaggedStudentsCount: flaggedStudents.length,
    quizSummary,
    students: studentsWithScores
  };
}

// End session
app.post('/api/sessions/:id/end', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.status = 'ended';
  session.locked = false;
  session.endedAt = new Date().toISOString();

  // Compute final statistics
  session.statistics = calculateSessionStats(session);

  // Notify all students
  io.to(`session-${session.id}`).emit('session-ended', {
    message: 'Dars tugadi!',
    duration: session.statistics.actualDuration
  });

  res.json({
    success: true,
    statistics: session.statistics
  });
});

// Get session stats
app.get('/api/sessions/:id/stats', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  if (!session.statistics) {
    session.statistics = calculateSessionStats(session);
  }

  res.json({ success: true, statistics: session.statistics });
});

// Unlock students
app.post('/api/sessions/:id/unlock', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.locked = false;

  io.to(`session-${session.id}`).emit('session-unlocked', {
    message: 'Ustoz ruxsat berdi! Telefoningizdan foydalanishingiz mumkin.'
  });

  res.json({ success: true });
});

// Lock students again
app.post('/api/sessions/:id/lock', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.locked = true;

  io.to(`session-${session.id}`).emit('session-locked', {
    message: 'Ustoz telefonni blokladi.'
  });

  res.json({ success: true });
});

// Get session history / stats
app.get('/api/stats', authMiddleware, (req, res) => {
  const teacherSessions = db.sessions.filter(s => s.teacherId === req.teacherId);

  const totalSessions = teacherSessions.length;
  const totalStudents = teacherSessions.reduce((acc, s) => acc + s.students.length, 0);
  const activeSessions = teacherSessions.filter(s => s.status === 'active').length;

  const enrichedSessions = teacherSessions.slice(-20).reverse().map(s => {
    return {
      id: s.id,
      name: s.name,
      subject: s.subject,
      status: s.status,
      duration: s.duration,
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      studentCount: s.students ? s.students.length : 0,
      students: s.students || [],
      statistics: s.statistics || calculateSessionStats(s)
    };
  });

  res.json({
    totalSessions,
    totalStudents,
    activeSessions,
    recentSessions: enrichedSessions
  });
});

// ============================================
// SOCKET.IO - REAL-TIME
// ============================================

io.on('connection', (socket) => {
  console.log('🔌 Yangi ulanish:', socket.id);

  // Student joins session
  socket.on('student-join', (data) => {
    const { sessionId, studentName, device } = data;
    const session = db.sessions.find(s => s.id === sessionId);

    if (!session || session.status !== 'active') {
      socket.emit('join-error', { message: 'Sessiya topilmadi yoki tugagan' });
      return;
    }

    const student = {
      id: uuidv4().substring(0, 8),
      name: studentName,
      device: device || 'Noma\'lum qurilma',
      joinedAt: new Date().toISOString(),
      isActive: true,
      socketId: socket.id,
      violationsCount: 0,
      violations: []
    };

    session.students.push(student);
    socket.join(`session-${sessionId}`);
    socket.studentData = { sessionId, studentId: student.id };

    // Notify teacher
    io.to(`teacher-${sessionId}`).emit('student-joined', {
      student,
      totalStudents: session.students.length,
      activeStudents: session.students.filter(s => s.isActive).length
    });

    // Send session info to student (include active quiz or material if already sent)
    socket.emit('join-success', {
      studentId: student.id,
      sessionName: session.name,
      subject: session.subject,
      locked: session.locked,
      duration: session.duration,
      activeQuiz: session.activeQuiz ? {
        quizId: session.activeQuiz.id,
        title: session.activeQuiz.title,
        questions: session.activeQuiz.questions.map(q => ({ id: q.id, text: q.text, options: q.options })),
        timeLimit: session.activeQuiz.timeLimit
      } : null,
      activeMaterial: session.activeMaterial || null
    });
  });

  // Teacher sends a Quiz
  socket.on('teacher-send-quiz', (data) => {
    const { sessionId, quiz } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.activeQuiz = {
      id: uuidv4().substring(0, 8),
      title: quiz.title || 'Tezkor Test',
      questions: quiz.questions || [],
      timeLimit: quiz.timeLimit || 0,
      createdAt: new Date().toISOString()
    };
    session.quizSubmissions = [];

    const sanitizedQuestions = session.activeQuiz.questions.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options
    }));

    io.to(`session-${sessionId}`).emit('new-quiz', {
      quizId: session.activeQuiz.id,
      title: session.activeQuiz.title,
      questions: sanitizedQuestions,
      timeLimit: session.activeQuiz.timeLimit
    });

    socket.emit('quiz-broadcast-success', {
      quizId: session.activeQuiz.id,
      title: session.activeQuiz.title,
      questionsCount: session.activeQuiz.questions.length
    });
  });

  // Student submits Quiz answers
  socket.on('student-submit-quiz', (data) => {
    const { sessionId, studentId, studentName, quizId, answers } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session || !session.activeQuiz || session.activeQuiz.id !== quizId) return;

    // Check if already submitted
    const existing = session.quizSubmissions.find(sub => sub.studentId === studentId);
    if (existing) return;

    let correctCount = 0;
    const questions = session.activeQuiz.questions;
    const results = questions.map(q => {
      const selected = answers[q.id];
      const isCorrect = selected !== undefined && Number(selected) === Number(q.correctIndex);
      if (isCorrect) correctCount++;
      return {
        questionId: q.id,
        selected,
        correctIndex: q.correctIndex,
        isCorrect
      };
    });

    const totalQuestions = questions.length;
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const submission = {
      studentId,
      studentName,
      correctCount,
      totalQuestions,
      percentage,
      submittedAt: new Date().toISOString()
    };

    session.quizSubmissions.push(submission);

    const student = session.students.find(s => s.id === studentId);
    if (student) {
      student.quizScore = `${correctCount}/${totalQuestions} (${percentage}%)`;
      student.quizPercentage = percentage;
    }

    // Send result to the student
    socket.emit('quiz-result', {
      correctCount,
      totalQuestions,
      percentage,
      results
    });

    // Send update to teacher
    io.to(`teacher-${sessionId}`).emit('quiz-submission-update', {
      submission,
      totalSubmissions: session.quizSubmissions.length,
      totalStudents: session.students.length,
      submissions: session.quizSubmissions
    });
  });

  // Teacher sends Material / Link
  socket.on('teacher-send-material', (data) => {
    const { sessionId, material } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.activeMaterial = {
      title: material.title || 'Dars Materiali',
      text: material.text || '',
      url: material.url || '',
      sentAt: new Date().toISOString()
    };

    io.to(`session-${sessionId}`).emit('new-material', session.activeMaterial);
    socket.emit('material-broadcast-success', session.activeMaterial);
  });

  // Teacher joins to monitor
  socket.on('teacher-monitor', (data) => {
    const { sessionId } = data;
    socket.join(`teacher-${sessionId}`);
    console.log(`👨‍🏫 O'qituvchi monitoring: ${sessionId}`);
  });

  // Student left page (visibility change)
  socket.on('student-left-page', (data) => {
    const { sessionId, studentId } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      const student = session.students.find(s => s.id === studentId);
      if (student) {
        student.isActive = false;
        student.violationsCount = (student.violationsCount || 0) + 1;
        if (!student.violations) student.violations = [];
        student.violations.push({
          time: new Date().toISOString(),
          type: 'left_page'
        });

        io.to(`teacher-${sessionId}`).emit('student-violation', {
          student,
          violationsCount: student.violationsCount,
          message: `⚠️ ${student.name} sahifadan chiqdi! (${student.violationsCount}-marta)`,
          time: new Date().toISOString()
        });
      }
    }
  });

  // Student returned to page
  socket.on('student-returned', (data) => {
    const { sessionId, studentId } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      const student = session.students.find(s => s.id === studentId);
      if (student) {
        student.isActive = true;
        io.to(`teacher-${sessionId}`).emit('student-returned', {
          student,
          message: `✅ ${student.name} qaytib keldi`,
          time: new Date().toISOString()
        });
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.studentData) {
      const { sessionId, studentId } = socket.studentData;
      const session = db.sessions.find(s => s.id === sessionId);
      if (session) {
        const student = session.students.find(s => s.id === studentId);
        if (student) {
          student.isActive = false;
          io.to(`teacher-${sessionId}`).emit('student-disconnected', {
            student,
            message: `🔴 ${student.name} ulanish uzildi`,
            totalStudents: session.students.length,
            activeStudents: session.students.filter(s => s.isActive).length
          });
        }
      }
    }
    console.log('🔌 Ulanish uzildi:', socket.id);
  });
});

// ============================================
// HTML ROUTES
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║   🎓 EduFocus Server ishga tushdi!       ║
║                                          ║
║   📍 http://localhost:${PORT}              ║
║                                          ║
╚══════════════════════════════════════════╝
  `);
});
