try {
  const TelegramBot = require("node-telegram-bot-api");
  const fs = require("fs");
  const sqlite3 = require("sqlite3").verbose();
  require("dotenv").config();

  // Инициализация бота
  const bot = new TelegramBot(process.env.API_KEY, { polling: true });
  const db = new sqlite3.Database("./tasks.db");

  // Создаем таблицы
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      title TEXT,
      description TEXT,
      deadline TEXT,
      executor TEXT CHECK(executor IN ('МУП', 'МОП', 'Директор', 'Колледж')),
      status TEXT DEFAULT 'Новая',
      photos TEXT DEFAULT '[]',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });

  // Состояния пользователей
  const userStates = {};
  const Executors = ["МУП", "МОП", "Директор", "Колледж"];

  // Обновленные команды
  const commands = [
    { command: "start", description: "Запуск бота" },
    { command: "newtask", description: "Создать новую задачу" },
    { command: "alltasks", description: "Все задачи" },
    { command: "categorytasks", description: "Задачи по исполнителям" },
  ];

  bot.setMyCommands(commands);

  // Добавляем константы для календаря
  const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  // Добавляем обработчик для фото
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];

    if (state?.step === "photo") {
      try {
        // Получаем file_id самого большого варианта фото
        const photo = msg.photo[msg.photo.length - 1];
        state.data.photos = state.data.photos || [];
        state.data.photos.push(photo.file_id);

        await bot.sendMessage(chatId, 'Фото добавлено! Отправьте еще или нажмите "Готово"', {
          reply_markup: {
            keyboard: [["Готово"]],
            resize_keyboard: true,
          },
        });
      } catch (error) {
        console.error("Error processing photo:", error);
        await bot.sendMessage(chatId, "Ошибка при обработке фото");
      }
    }
  });
  // Обработчики сообщений
  bot.on("text", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    try {
      if (text.startsWith("/start" || text === "🏠 Главное меню")) {
        await showMainMenu(chatId);
      } else if (text === "📝 Создать задачу" || text === "/newtask") {
        await startTaskCreation(chatId);
      } else if (text === "🌐 Все задачи" || text === "/alltasks") {
        await showAllTasks(chatId);
      } else if (text === "🆘 Помощь") {
        await showHelp(chatId);
      } else if (text === "👥 Задачи по исполнителю" || text === "/categorytasks") {
        await showExecutorFilterMenu(chatId);
      } else if (userStates[chatId]?.step) {
        await handleTaskState(chatId, text);
      } else {
        await bot.sendMessage(chatId, "Несуществующая команда");
        await showMainMenu(chatId);
      }
    } catch (error) {
      console.error(error);
      await bot.sendMessage(chatId, "Ошибка обработки запроса");
    }
  });

  // Логика создания задачи
  async function startTaskCreation(chatId) {
    userStates[chatId] = {
      step: "title",
      data: {},
    };
    await bot.sendMessage(chatId, "Введите название задачи:");
  }
  async function showHelp(chatId) {
    await bot.sendMessage(
      chatId,
      `🆘 Справка:\n\n1. Создание задачи - используйте кнопку "📝 Создать задачу"\n2. Просмотр задач - "🌐 Все задачи"\n3. Завершение задач - "✅ Завершить задачу"`,
      {
        parse_mode: "Markdown",
      }
    );
  }

  // Меню выбора исполнителя для фильтрации
  async function showExecutorFilterMenu(chatId) {
    await bot.sendMessage(chatId, "Выберите исполнителя:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "МУП", callback_data: "filter_МУП" }],
          [{ text: "МОП", callback_data: "filter_МОП" }],
          [{ text: "Директор", callback_data: "filter_Директор" }],
          [{ text: "Колледж", callback_data: "filter_Колледж" }],
        ],
      },
    });
  }

  async function handleTaskState(chatId, text) {
    const state = userStates[chatId];

    switch (state.step) {
      case "title":
        state.data.title = text;
        state.step = "description";
        await bot.sendMessage(chatId, "Введите подробное описание задачи:");
        break;

      case "description":
        state.data.description = text;
        state.step = "deadline";
        await sendCalendar(chatId); // Отправляем календарь вместо запроса ручного ввода
        break;

      // case "deadline":
      //   if (!isValidDate(text)) {
      //     return await bot.sendMessage(chatId, "Неверный формат даты! Используйте ДД.ММ.ГГГГ");
      //   }
      //   state.data.deadline = text;
      //   state.step = "executor";
      //   await bot.sendMessage(chatId, "Выберите исполнителя:", {
      //     reply_markup: {
      //       keyboard: [Executors],
      //       resize_keyboard: true,
      //     },
      //   });
      //   break;

      case "executor":
        if (!Executors.includes(text)) {
          return await bot.sendMessage(chatId, "Выберите исполнителя из предложенных вариантов");
        }
        state.data.executor = text;
        state.step = "photo";
        await bot.sendMessage(chatId, "Отправьте фото для задачи (если нужно) или нажмите 'Готово'", {
          reply_markup: {
            keyboard: [["Готово"]],
            resize_keyboard: true,
          },
        });
        break;

      case "photo":
        if (text === "Готово") {
          await saveTaskToDB(chatId, state.data);
          delete userStates[chatId];
          await bot.sendMessage(chatId, "Задача успешно создана!", {
            reply_markup: { remove_keyboard: true },
          });
        }
        break;
    }
  }

  // // Валидация даты
  // function isValidDate(dateString) {
  //   const pattern = /^(\d{2})\.(\d{2})\.(\d{4})$/;
  //   return pattern.test(dateString);
  // }
  // Добавляем функции для работы с календарем
  async function sendCalendar(chatId, date = new Date()) {
    const keyboard = generateCalendarKeyboard(date);
    await bot.sendMessage(chatId, "Выберите дату выполнения:", {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
  }
  function generateCalendarKeyboard(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth();
    // Корректное определение последнего дня месяца
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Получаем первый день месяца (с понедельника)
    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    const keyboard = [];

    // Шапка с месяцем и годом
    keyboard.push([
      {
        text: `${monthNames[month]} ${year}`,
        callback_data: "ignore",
      },
    ]);

    // Дни недели
    keyboard.push(dayNames.map((day) => ({ text: day, callback_data: "ignore" })));

    // Ячейки календаря
    let week = [];
    // Добавляем пустые ячейки для первого ряда
    for (let i = 0; i < startDay; i++) {
      week.push({ text: " ", callback_data: "ignore" });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const callbackData = `date_${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      week.push({ text: String(day), callback_data: callbackData });

      if (week.length === 7) {
        keyboard.push(week);
        week = [];
      }
    }

    // Добавляем оставшиеся дни
    if (week.length > 0) {
      while (week.length < 7) {
        week.push({ text: " ", callback_data: "ignore" });
      }
      keyboard.push(week);
    }

    // Кнопки навигации
    keyboard.push([
      {
        text: "◀️",
        callback_data: `prevmonth_${year}-${month}`,
      },
      {
        text: "▶️",
        callback_data: `nextmonth_${year}-${month}`,
      },
    ]);

    return keyboard;
  }

  // Сохранение в БД
  function saveTaskToDB(chatId, taskData) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tasks (chatId, title, description, deadline, executor, photos) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [chatId, taskData.title, taskData.description, taskData.deadline, taskData.executor, JSON.stringify(taskData.photos || [])],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async function showAllTasks(chatId) {
    db.all("SELECT * FROM tasks ORDER BY deadline", async (err, tasks) => {
      if (err) {
        console.error(err);
        return await bot.sendMessage(chatId, "Ошибка получения задач");
      }

      if (tasks.length === 0) {
        return await bot.sendMessage(chatId, "Нет задач в системе");
      }

      for (const task of tasks) {
        // Отправляем фото если есть
        const photos = JSON.parse(task.photos || "[]");
        if (photos.length > 0) {
          await bot.sendMediaGroup(
            chatId,
            photos.map((photo_id) => ({
              type: "photo",
              media: photo_id,
            }))
          );
        }

        // Отправляем информацию о задаче
        await bot.sendMessage(chatId, formatTask(task), createTaskKeyboard(task));
      }
    });
  }

  // Меню
  async function showMainMenu(chatId) {
    await bot.sendMessage(chatId, "🏠 Главное меню:", {
      reply_markup: {
        keyboard: [["📝 Создать задачу", "👥 Задачи по исполнителю"], ["🌐 Все задачи"]],
        resize_keyboard: true,
      },
    });
  }

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    try {
      // Обработка изменения статуса
      if (data.startsWith("status_")) {
        const [action, taskId, newStatus, executor] = data.split("_");
        await updateTaskStatus(taskId, newStatus);
        await bot.answerCallbackQuery(query.id, { text: "Статус обновлен!" });
        await bot.deleteMessage(chatId, messageId);
        await showTasksByExecutor(chatId, executor);
      }

      // Обработка удаления задачи
      if (data.startsWith("delete_")) {
        const taskId = data.split("_")[1];
        const executor = data.split("_")[2];
        await deleteTask(taskId);
        await bot.answerCallbackQuery(query.id, { text: "Задача удалена!" });
        await bot.deleteMessage(chatId, messageId);
        await showTasksByExecutor(chatId, executor);
      }

      // Фильтрация по исполнителям
      if (data.startsWith("filter_")) {
        const executor = data.split("_")[1];
        await showTasksByExecutor(chatId, executor);
      }

      // Обработка выбора даты
      if (data.startsWith("date_")) {
        const selectedDate = data.split("_")[1];
        const [year, month, day] = selectedDate.split("-");

        // Сохраняем дату в формате ДД.ММ.ГГГГ
        userStates[chatId].data.deadline = `${day}.${month}.${year}`;

        // Удаляем сообщение с календарем
        await bot.deleteMessage(chatId, messageId);

        // Переходим к выбору исполнителя
        userStates[chatId].step = "executor";
        await bot.sendMessage(chatId, "Выберите исполнителя:", {
          reply_markup: {
            keyboard: [Executors],
            resize_keyboard: true,
          },
        });
      }

      if (data.startsWith("prevmonth_") || data.startsWith("nextmonth_")) {
        const [action, params] = data.split("_");
        const [yearStr, monthStr] = params.split("-");
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        let newDate = new Date(year, month);

        if (action === "prevmonth") {
          newDate.setMonth(newDate.getMonth() - 1);
        } else {
          newDate.setMonth(newDate.getMonth() + 1);
        }
        // Обновляем календарь
        try {
          await bot.editMessageReplyMarkup(
            {
              inline_keyboard: generateCalendarKeyboard(newDate),
            },
            {
              chat_id: chatId,
              message_id: messageId,
            }
          );
        } catch (e) {
          console.error("Error updating calendar:", e);
        }
      }
    } catch (error) {
      console.error(error);
      await bot.answerCallbackQuery(query.id, { text: "Ошибка операции!" });
    }
  });

  // Функция обновления статуса задачи
  async function updateTaskStatus(taskId, newStatus) {
    return new Promise((resolve, reject) => {
      db.run("UPDATE tasks SET status = ? WHERE id = ?", [newStatus, taskId], (err) => (err ? reject(err) : resolve()));
    });
  }
  // Функция удаления задачи
  async function deleteTask(taskId) {
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM tasks WHERE id = ?", [taskId], (err) => (err ? reject(err) : resolve()));
    });
  }

  // Функция вывода задач по исполнителю
  async function showTasksByExecutor(chatId, executor) {
    db.all("SELECT * FROM tasks WHERE executor = ? ORDER BY deadline", [executor], async (err, tasks) => {
      if (err) {
        console.error(err);
        return await bot.sendMessage(chatId, "Ошибка получения задач");
      }

      if (tasks.length === 0) {
        return await bot.sendMessage(chatId, `Нет задач для исполнителя ${executor}`);
      }

      for (const task of tasks) {
        await bot.sendMessage(chatId, formatTask(task), createTaskKeyboard(task));
      }
    });
  }

  // Функция для создания inline-клавиатуры
  function createTaskKeyboard(task) {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Завершить", callback_data: `status_${task.id}_Завершена_${task.executor}` },
            { text: "✏️ В работе", callback_data: `status_${task.id}_В работе__${task.executor}` },
          ],
          [{ text: "❌ Удалить", callback_data: `delete_${task.id}_${task.executor}` }],
        ],
      },
    };
  }

  // Функция отображения задач
  function formatTask(task) {
    let text = `
    🔹 ${task.title}
    📅 Срок: ${task.deadline}
    👤 Исполнитель: ${task.executor}
    📝 Описание: ${task.description}
    🔄 Статус: ${task.status}
    📸 Фото: ${JSON.parse(task.photos).length} шт.
    
    [ID: ${task.id}]
        `.trim();

    return text;
  }
} catch (e) {
  console.log(e);
}
