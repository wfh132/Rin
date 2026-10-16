import i18next from "i18next";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Helmet } from 'react-helmet';
import { useTranslation } from "react-i18next";
import { FlatActionButton, FlatPanel, Modal, SearchableSelect } from "@rin/ui";
import { ShowAlertType, useAlert, useConfirm } from "../components/dialog";
import { Input } from "../components/input";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";

import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";


type FriendItem = {
    name: string;
    category?: FriendCategory;
    id: number;
    uid: number;
    avatar: string;
    createdAt: Date;
    updatedAt: Date;
    desc: string | null;
    url: string;
    accepted: number;
    health: string;
    sort_order?: number;
};

const DEFAULT_FRIEND_CATEGORIES = ["软件导航", "实用工具", "未分类"] as const;
const CUSTOM_FRIEND_CATEGORIES_KEY = "rin.my-friends.categories";
type FriendCategory = string;

function readCustomFriendCategories() {
    if (typeof window === "undefined") return [];

    try {
        const categories: unknown = JSON.parse(localStorage.getItem(CUSTOM_FRIEND_CATEGORIES_KEY) ?? "[]");
        return Array.isArray(categories)
            ? categories.filter((category): category is string =>
                typeof category === "string" && category.trim().length > 0
            )
            : [];
    } catch {
        return [];
    }
}

function encodeFriendName(category: FriendCategory, name: string) {
    const categoryPrefix = category === "未分类" ? "" : `[${encodeURIComponent(category)}]`;
    return `[分组2]${categoryPrefix}${name}`;
}

async function publish({ name, category, avatar, desc, url, showAlert }: { name: string, category: FriendCategory, avatar: string, desc: string, url: string, showAlert: ShowAlertType }) {
    const t = i18next.t
    const { error } = await client.friend.create({
        avatar,
        name: encodeFriendName(category, name),
        desc,
        url
    })
    if (error) {
        showAlert(error.value as string)
    } else {
        showAlert(t('create.success'), () => {
            window.location.reload()
        })
    }
}

export function MyFriendsPage() {
    const { t } = useTranslation()
    const siteConfig = useSiteConfig();
    const config = useContext(ClientConfigContext)
    let [apply] = useState<FriendItem>()
    const [name, setName] = useState("")
    const [category, setCategory] = useState<FriendCategory>("")
    const [customCategories, setCustomCategories] = useState<string[]>(readCustomFriendCategories)
    const [newCategory, setNewCategory] = useState("")
    const [desc, setDesc] = useState("")
    const [avatar, setAvatar] = useState("")
    const [url, setUrl] = useState("")
    const profile = useContext(ProfileContext);
    const [friendsAvailable, setFriendsAvailable] = useState<FriendItem[]>([])
    const [allFriends, setAllFriends] = useState<FriendItem[]>([])
    const [waitList, setWaitList] = useState<FriendItem[]>([])
    const [refusedList, setRefusedList] = useState<FriendItem[]>([])
    const [friendsUnavailable, setFriendsUnavailable] = useState<FriendItem[]>([])
    const [status, setStatus] = useState<'idle' | 'loading'>('loading')
    const ref = useRef(false)
    const { showAlert, AlertUI } = useAlert()
    const { showConfirm, ConfirmUI } = useConfirm()
    useEffect(() => {
        if (ref.current) return
        client.friend.list().then(({ data }) => {
            if (data) {
                const friend_list = (data.friend_list || [])
                    .filter((item) => item.name.startsWith("[分组2]"))
                    .map((item) => {
                        const nameWithoutGroup = item.name.replace(/^\[分组2\]/, "")
                        const categoryMatch = /^\[([^\]]+)\]/.exec(nameWithoutGroup)
                        let friendCategory = "未分类"
                        if (categoryMatch) {
                            try {
                                friendCategory = decodeURIComponent(categoryMatch[1])
                            } catch {
                                friendCategory = categoryMatch[1]
                            }
                        }
                        return {
                            ...item,
                            category: friendCategory,
                            name: categoryMatch
                                ? nameWithoutGroup.slice(categoryMatch[0].length)
                                : nameWithoutGroup,
                        }
                    })
                    setAllFriends(friend_list as FriendItem[])
                const friends_available = friend_list.filter(({ health, accepted }: any) => health.length === 0 && accepted === 1) || []
                setFriendsAvailable(friends_available as any)
                const friends_unavailable = friend_list.filter(({ health, accepted }: any) => health.length > 0 && accepted === 1) || []
                setFriendsUnavailable(friends_unavailable as any)
                const waitList = friend_list.filter(({ accepted }: any) => accepted === 0) || []
                setWaitList(waitList as any)
                const refuesdList = friend_list.filter(({ accepted }: any) => accepted === -1) || []
                setRefusedList(refuesdList as any)
            }
            setStatus('idle')
        })
        ref.current = true
    }, [])
    const friendCategories = [...new Set([
        ...DEFAULT_FRIEND_CATEGORIES,
        ...customCategories,
        ...friendsAvailable.map((friend) => friend.category).filter((value): value is string => Boolean(value)),
    ])]
    function addCategory() {
        const nextCategory = newCategory.trim()
        if (!nextCategory) return

        if (!friendCategories.includes(nextCategory)) {
            const nextCategories = [...customCategories, nextCategory]
            setCustomCategories(nextCategories)
            try {
                localStorage.setItem(CUSTOM_FRIEND_CATEGORIES_KEY, JSON.stringify(nextCategories))
            } catch {}
        }

        setCategory(nextCategory)
        setNewCategory("")
    }
    function deleteCategory(categoryToDelete: string) {
        const removeCategory = () => {
            const nextCategories = customCategories.filter((value) => value !== categoryToDelete)
            setCustomCategories(nextCategories)
            try {
                localStorage.setItem(CUSTOM_FRIEND_CATEGORIES_KEY, JSON.stringify(nextCategories))
            } catch {}
            if (category === categoryToDelete) setCategory("")
        }
        const categorizedFriends = allFriends.filter((friend) => friend.category === categoryToDelete)

        if (categorizedFriends.length === 0) {
            removeCategory()
            return
        }

        showConfirm(
            "删除分类",
            `分类“${categoryToDelete}”中有 ${categorizedFriends.length} 个友链，删除后会移到“未分类”。`,
            async () => {
                const results = await Promise.all(categorizedFriends.map((friend) =>
                    client.friend.update(friend.id, {
                        avatar: friend.avatar,
                        name: encodeFriendName("未分类", friend.name),
                        desc: friend.desc ?? "",
                        url: friend.url,
                        accepted: friend.accepted,
                        sort_order: friend.sort_order ?? 0,
                    })
                ))
                const failedUpdate = results.find((result) => result.error)
                if (failedUpdate?.error) {
                    showAlert(failedUpdate.error.value as string)
                    return
                }

                removeCategory()
                window.location.reload()
            }
        )
    }
    function publishButton() {
        if (!category) {
            showAlert("请先选择分类")
            return
        }
        publish({ name, category, desc, avatar, url, showAlert })
    }
    return (<>
        <Helmet>
            <title>{`导航 - ${siteConfig.name}`}</title>
            <meta property="og:site_name" content={siteName} />
            <meta property="og:title" content="导航" />
            <meta property="og:image" content={siteConfig.avatar} />
            <meta property="og:type" content="article" />
            <meta property="og:url" content={document.URL} />
        </Helmet>
        <Waiting for={friendsAvailable.length !== 0 || friendsUnavailable.length !== 0 || status === "idle"}>
            <main className="w-full flex flex-col justify-center items-center mb-8 t-primary ani-show">
                {friendCategories.map((friendCategory) => {
                    const categorizedFriends = friendsAvailable.filter((friend) => friend.category === friendCategory)
                    return (
                        <FriendList
                            key={friendCategory}
                            title={friendCategory}
                            show={categorizedFriends.length > 0}
                            friends={categorizedFriends}
                        />
                    )
                })}
                <FriendList title={t('friends.left')} show={friendsUnavailable.length > 0} friends={friendsUnavailable} />
                <FriendList title={t('friends.review.waiting')} show={waitList.length > 0} friends={waitList} />
                <FriendList title={t('friends.review.rejected')} show={refusedList.length > 0} friends={refusedList} />
                <FriendList title={t('friends.my_apply')} show={profile?.permission !== true && apply !== undefined} friends={apply ? [apply] : []} />
                {profile && (profile.permission || config.get("friend_apply_enable")) &&
                    <div className="wauto t-primary flex text-start text-2xl font-bold mt-8">
                        <FlatPanel className="md:basis-1/2 p-6">
                            <p>
                                {profile.permission ? t('friends.create') : t('friends.apply')}
                            </p>
                            <div className="text-sm mt-4 text-neutral-500 font-normal">
                                <SearchableSelect
                                    value={category}
                                    onChange={(nextValue) => setCategory(nextValue as FriendCategory)}
                                    options={friendCategories.map((value) => ({ label: value, value }))}
                                    placeholder="请选择分类"
                                    searchPlaceholder="请选择分类"
                                />
                                {profile.permission && <>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Input
                                            value={newCategory}
                                            setValue={setNewCategory}
                                            placeholder="输入新分类名称"
                                            variant="flat"
                                            className="min-w-0 flex-1"
                                        />
                                        <FlatActionButton
                                            type="button"
                                            onClick={addCategory}
                                            disabled={!newCategory.trim()}
                                        >
                                            新增分类
                                        </FlatActionButton>
                                    </div>
                                    {customCategories.map((customCategory) => (
                                        <div key={customCategory} className="mt-2 flex items-center justify-between gap-3">
                                            <span className="truncate text-sm">{customCategory}</span>
                                            <FlatActionButton
                                                type="button"
                                                onClick={() => deleteCategory(customCategory)}
                                                className="shrink-0 text-theme"
                                            >
                                                <i className="ri-delete-bin-line mr-1" aria-hidden="true" />
                                                删除分类
                                            </FlatActionButton>
                                        </div>
                                    ))}
                                </>}
                                <Input value={name} setValue={setName} placeholder={t('sitename')} variant="flat" />
                                <Input value={desc} setValue={setDesc} placeholder={t('description')} variant="flat" className="mt-2" />
                                <Input value={avatar} setValue={setAvatar} placeholder={t('avatar.url')} variant="flat" className="mt-2" />
                                <Input value={url} setValue={setUrl} placeholder={t('url')} variant="flat" className="my-2" />
                                <div className='flex flex-row justify-center'>
                                    <button onClick={publishButton} disabled={!category} className='basis-1/2 rounded-full bg-theme py-4 text-white disabled:opacity-50'>{t('create.title')}</button>
                                </div>
                            </div>
                        </FlatPanel>
                    </div>
                }
            </main>
        </Waiting>
        <ConfirmUI />
        <AlertUI />
    </>)
}

function FriendList({ title, show, friends }: { title: string, show: boolean, friends: FriendItem[] }) {
    return (<>
        {
            show && <>
                <div className="wauto text-start py-4">
                    <p className="text-sm mt-4 text-neutral-500 font-normal">
                        {title}
                    </p>
                </div>
                <div className="wauto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {friends.map((friend) => (
                        <Friend key={friend.id} friend={friend} />
                    ))}
                </div>
            </>
        }
    </>)
}

function Friend({ friend }: { friend: FriendItem }) {
    const { t } = useTranslation()
    const profile = useContext(ProfileContext)
    const [avatar, setAvatar] = useState(friend.avatar)
    const [name, setName] = useState(friend.name)
    const [category, setCategory] = useState<FriendCategory>(friend.category ?? "未分类")
    const categoryOptions = [...new Set([
        ...DEFAULT_FRIEND_CATEGORIES,
        ...readCustomFriendCategories(),
        category,
    ])]
    const [desc, setDesc] = useState(friend.desc || "")
    const [url, setUrl] = useState(friend.url)
    const [status, setStatus] = useState(friend.accepted)
    const [sortOrder, setSortOrder] = useState(friend.sort_order || 0)
    const [modalIsOpen, setIsOpen] = useState(false);
    const { showConfirm, ConfirmUI } = useConfirm()
    const { showAlert, AlertUI } = useAlert()

    const deleteFriend = useCallback(() => {
        showConfirm(
            t('delete.title'),
            t('delete.confirm'),
            () => {
                client.friend.delete(friend.id).then(({ error }) => {
                    if (error) {
                        showAlert(error.value as string)
                    } else {
                        showAlert(t('delete.success'), () => {
                            window.location.reload()
                        })
                    }
                })
            })
    }, [friend.id])

    const updateFriend = useCallback(() => {
        client.friend.update(friend.id, {
            avatar,
            name: encodeFriendName(category, name),
            desc,
            url,
            accepted: status,
            sort_order: sortOrder
        }).then(({ error }) => {
            if (error) {
                showAlert(error.value as string)
            } else {
                showAlert(t('update.success'), () => {
                    window.location.reload()
                })
            }
        })
    }, [avatar, name, category, desc, url, status, sortOrder])

    const statusOption = [
        { value: -1, label: t('friends.review.rejected') },
        { value: 0, label: t('friends.review.waiting') },
        { value: 1, label: t('friends.review.accepted') }
    ]
    return (
        <>
            <a title={friend.name} href={friend.url} target="_blank" rel="noopener noreferrer" className="relative flex min-w-0 w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-w p-4 bg-button">
                <ImageWithFallback
                    className="h-16 w-16 rounded-full"
                    imageClassName={friend.health.length > 0 ? "grayscale" : ""}
                    src={friend.avatar}
                    alt={friend.name}
                />
                <p className="mt-1 max-w-full truncate text-center text-base">{friend.name}</p>
                {friend.health.length == 0 && <p className="line-clamp-2 max-w-full text-center text-sm text-neutral-500 [overflow-wrap:anywhere]">{friend.desc}</p>}
                {friend.accepted !== 1 && <p className={`${friend.accepted === 0 ? "t-primary" : "text-theme"}`}>{statusOption[friend.accepted + 1].label}</p>}
                {friend.health.length > 0 && <p className="max-w-full text-center text-sm text-gray-500 [overflow-wrap:anywhere]">{errorHumanize(friend.health)}</p>}
                {(profile?.permission || profile?.id === friend.uid) && <>
                    <button onClick={(e) => { e.preventDefault(); setIsOpen(true) }} className="absolute top-0 right-0 m-2 px-2 py-1 bg-secondary t-primary rounded-full bg-button">
                        <i className="ri-settings-line"></i>
                    </button></>}
            </a>

            <Modal
                isOpen={modalIsOpen}
                onRequestClose={() => setIsOpen(false)}
                contentLabel={t('update$sth', { sth: friend.name })}
                panelClassName="overflow-visible p-6"
            >
                <div className="relative flex w-full flex-col items-center justify-start">
                    <ImageWithFallback
                        className="h-16 w-16 rounded-xl"
                        imageClassName={friend.health.length > 0 ? "grayscale" : ""}
                        src={friend.avatar}
                        alt={friend.name}
                    />
                    {profile?.permission &&
                        <div className="flex flex-col w-full items-start mt-4 px-4">
                            <SearchableSelect
                                value={category}
                                onChange={(nextValue) => setCategory(nextValue as FriendCategory)}
                                options={categoryOptions.map((value) => ({ label: value, value }))}
                                placeholder="选择分类"
                                searchPlaceholder="选择分类"
                            />
                            <div className="flex flex-row justify-between w-full items-center">
                                <div className="flex flex-col">
                                    <p className="text-lg dark:text-white">
                                        {t('status')}
                                    </p>
                                </div>
                                <div className="flex flex-row items-center justify-center space-x-4">
                                    <SearchableSelect
                                        value={String(status)}
                                        onChange={(nextValue) => {
                                            const parsed = Number(nextValue)
                                            if (!Number.isNaN(parsed)) {
                                                setStatus(parsed)
                                            }
                                        }}
                                        options={statusOption.map((option) => ({
                                            label: option.label,
                                            value: String(option.value),
                                        }))}
                                        placeholder={t('status')}
                                        searchPlaceholder={t('status')}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-row justify-between w-full items-center mt-2">
                                <div className="flex flex-col">
                                    <p className="text-lg dark:text-white">
                                        {t('sort_order')}
                                    </p>
                                </div>
                                <div className="flex flex-row items-center justify-center space-x-4">
                                    <Input
                                        value={sortOrder.toString()} 
                                        setValue={(val) => setSortOrder(parseInt(val) || 0)} 
                                        placeholder={t('sort_order')}
                                        variant="flat"
                                    />
                                </div>
                            </div>
                        </div>
                    }
                    <Input value={name} setValue={setName} placeholder={t('sitename')} variant="flat" className="mt-4" />
                    <Input value={desc} setValue={setDesc} placeholder={t('description')} variant="flat" className="mt-2" />
                    <Input value={avatar} setValue={setAvatar} placeholder={t('avatar.url')} variant="flat" className="mt-2" />
                    <Input value={url} setValue={setUrl} placeholder={t('url')} variant="flat" className="my-2" />
                    <div className='flex flex-row justify-center space-x-2'>
                        <FlatActionButton onClick={deleteFriend} className="mt-2 text-theme">{t('delete.title')}</FlatActionButton>
                        <FlatActionButton onClick={updateFriend} className="mt-2 t-primary">{t('save')}</FlatActionButton>
                    </div>
                </div>
            </Modal>
            <ConfirmUI />
            <AlertUI />
        </>
    )
}

function errorHumanize(error: string) {
    if (error === "certificate has expired" || error == "526") {
        return "证书已过期"
    } else if (error.includes("Unable to connect") || error == "521" || error == "522") {
        return "无法访问"
    }
    return error
}
