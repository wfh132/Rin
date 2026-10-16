import { Helmet } from "react-helmet";

const CUSTOM_FRIENDS = [
  {
    name: "朋友 A",
    desc: "这里是朋友 A 的个人简介",
    avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix",
    url: "https://example.com",
  },
  {
    name: "朋友 B",
    desc: "这里是朋友 B 的个人简介",
    avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka",
    url: "https://example.org",
  },
];

export function MyFriendsPage() {
  return (
    <>
      <Helmet>
        <title>我的朋友</title>
      </Helmet>
      <div className="w-full flex flex-col justify-center items-center">
        <div className="wauto text-start text-black dark:text-white py-4">
          <p className="text-sm text-neutral-500 font-normal mb-6">
            这里是我独立维护的第二个友链列表
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {CUSTOM_FRIENDS.map((friend, idx) => (
              <a
                key={idx}
                title={friend.name}
                href={friend.url}
                target="_blank"
                rel="noreferrer"
                className="bg-button w-full rounded-xl p-4 flex flex-col justify-center items-center relative duration-300 group hover:bg-theme hover:text-white"
              >
                <div className="w-16 h-16 relative">
                  <img
                    alt={friend.name}
                    src={friend.avatar}
                    className="rounded-xl w-full h-full object-cover bg-white duration-300 group-hover:scale-105"
                  />
                  <div className="bg-green-500 w-3 h-3 rounded-full absolute bottom-0 right-0 border-2 border-white dark:border-neutral-800" />
                </div>
                <p className="text-base text-center mt-2 line-clamp-1 font-medium">
                  {friend.name}
                </p>
                <p className="text-xs text-neutral-400 group-hover:text-white/80 text-center mt-1 line-clamp-2">
                  {friend.desc}
                </p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}