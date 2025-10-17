const jsonServer = require('json-server');
const server = jsonServer.create();
const middlewares = jsonServer.defaults();
const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/fileSync');

const API_PREFIX = 'http://localhost:8080/api/v1';

const dataDir = path.join(__dirname, 'data');

const dbMap = {};
fs.readdirSync(dataDir).forEach(file => {
  if (file.endsWith('.json')) {
    const resourceName = file.replace('.json', '');
    const adapter = new FileSync(path.join(dataDir, file));
    dbMap[resourceName] = low(adapter);
  }
});

// Create a merged DB for json-server router
const db = {};
Object.keys(dbMap).forEach(resource => {
  db[resource] = dbMap[resource].get(resource).value() || [];
});

const router = jsonServer.router(db, { id: 'id' });

router.db._.id = 'id';
router.db._.createId = function (coll) {
  return String(coll.length + 1);
};

server.use(middlewares);
server.use(jsonServer.bodyParser);

const { loginResponses, profileResponses } = require('./responses'); 

const apiHandlers = {
  'auth/login': (req, res) => {
    const { username, password } = req.body;
    console.log("username: ",username)
    console.log("password: ",password)
    if (!username || !password ) {
      return res.status(400).jsonp(loginResponses.badRequest);
    }
    // console.log("dbMap: ",dbMap)
    const users = dbMap.users.get('users').value() || [];
    const user = users.find(u => u.email === username && u.password === password);

    if (user) {
      res.jsonp({ ...user, jwt: loginResponses.success.jwt });
    } else {
      res.status(401).jsonp(loginResponses.failure);
    }
  },

  'profile': (req, res) => {
    const userProfile = db.users[0];
    if (userProfile) {
      res.jsonp({
        ...profileResponses.success,
        profile: { username: userProfile.username, id: userProfile.id }
      });
    } else {
      res.status(404).jsonp(profileResponses.failure);
    }
  },

  'courses/:courseId/videos/:videoId': (req, res) => {
    const { courseId, videoId } = req.params;
    const courses = dbMap.courses.get('courses');
    const course = courses.find({ id: courseId }).value();

    if (!course) return res.status(404).jsonp({ error: "Course not found" });
    if (!course.videos || course.videos.length === 0) {
      return res.status(404).jsonp({ error: "No videos found for this course" });
    }

    const updatedVideos = course.videos.filter(v => String(v.id) !== String(videoId));
    course.videos = updatedVideos;

    courses.find({ id: courseId }).assign(course).write();
    db['courses'] = courses.value();

    res.jsonp({ message: "Video deleted successfully", course });
  }
};

// Register custom routes with API prefix
Object.entries(apiHandlers).forEach(([path, handler]) => {
  const fullPath = `${API_PREFIX}/${path}`;
  if (path === 'auth/login') {
    server.post(fullPath, handler);
  } else if (path.includes('courses/:courseId/videos/:videoId')) {
    server.delete(fullPath, handler);
  } else {
    server.get(fullPath, handler);
  }
  console.log(`Registered handler for: ${fullPath}`);
});

// Custom middleware for POST, PUT, DELETE
server.use((req, res, next) => {
  const resource = req.path.replace(`${API_PREFIX}/`, '').split('/')[0];
  if (!dbMap[resource]) return next();

  if (req.method === 'POST') {
    let data = req.body;
    
    // FIX 1: Initialize lectures array for new courses
    if (resource === 'courses' && !data.lectures) {
        data.lectures = [];
    }
    
    if (!data.id) {
      data.id = String(dbMap[resource].get(resource).value().length + 1);
    }

    try {
      dbMap[resource].get(resource).push(data).write();
      db[resource] = dbMap[resource].get(resource).value();
      return res.jsonp(data);
    } catch (e) {
      return res.status(500).jsonp({ error: 'Failed to save data' });
    }
  } else if (req.method === 'PUT') {
    const id = req.path.split('/').pop();
    const data = req.body;

    try {
      const resourceData = dbMap[resource].get(resource);
      const items = resourceData.value();
      const index = items.findIndex(item => String(item.id) === String(id));

      if (index === -1) return res.status(404).jsonp({ error: `${resource} not found` });

      // FIX 2: Merge new data with existing data to preserve fields like 'lectures'
      items[index] = { ...items[index], ...data, id };
      
      dbMap[resource].set(resource, items).write();
      db[resource] = items;

      return res.jsonp(items[index]);
    } catch (e) {
      return res.status(500).jsonp({ error: 'Failed to update data' });
    }
  } else if (req.method === 'DELETE') {
    const id = req.path.split('/').pop();

    try {
      const resourceData = dbMap[resource].get(resource);
      const items = resourceData.value();
      const index = items.findIndex(item => String(item.id) === String(id));

      if (index === -1) return res.status(404).jsonp({ error: `${resource} not found` });

      items.splice(index, 1);
      dbMap[resource].set(resource, items).write();
      db[resource] = items;

      return res.status(204).jsonp({});
    } catch (e) {
      return res.status(500).jsonp({ error: 'Failed to delete data' });
    }
  }

  next();
});

// Apply router for other CRUD operations
server.use(API_PREFIX, router);

server.listen(3000, () => {
  console.log('JSON Server is running on port 3000');
});



//Responce.json

// responses.js

// Responses for login API
export const loginResponses = {
  success: {
    jwt: "eyJhbGciOiJIUzI1NiJ9.dummy.jwt.token", // <-- replace with real JWT if needed
    message: "Login successful",
  },
  failure: {
    success: false,
    message: "Invalid email or password",
  },
  badRequest: {
    success: false,
    message: "Bad request: missing or invalid fields",
  },
};

// Responses for profile API
export const profileResponses = {
  success: {
    success: true,
    message: "User profile retrieved successfully",
  },
  failure: {
    success: false,
    message: "User not found",
  },
};


