try {
  const status = rs.status();
  if (status.ok) {
    quit();
  }
} catch (error) {
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'localhost:27017' }
    ]
  });
}
